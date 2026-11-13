/* Олбанский (падонкаф, ЖЖ 2003–2008): перевод русского текста на «олбанский». Один источник правды для сайта и бота.
 *
 * Принцип: олбанский — это орфография, при которой слово читается ВСЛУХ так же, как оригинал.
 * Поэтому никаких подмен, меняющих произношение; смысл, порядок слов, знаки, цифры, латиница, ссылки, @/# и смайлы сохраняются.
 * Всё детерминировано по seed (без Math.random), без внешних зависимостей, работает в браузере и в Node.
 *
 * Конвейер: токенизация → словарь фраз → словарь слов → морфо-фонетические правила → сборка.
 * Правила, зависящие от ударения, работают только если ударение известно (словарь stress.bin); иначе применяются только
 * правила, которым ударение не нужно.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Olbanian = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- утилиты ---------- */
  const VOW = 'аеёиоуыэюя';
  const isV = c => VOW.indexOf(c) >= 0;
  const isCons = c => /[бвгджзйклмнпрстфхцчшщ]/.test(c);
  const norm = s => s.replace(/ё/g, 'е');
  const RU_WORD = /^[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*$/;
  const TOK = /(https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|[@#][\wА-Яа-яЁё]+)|([A-Za-z0-9_]+(?:[-'][A-Za-z0-9_]+)*[А-Яа-яЁё]*|[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*[A-Za-z0-9_]*)|(\s+)|([\s\S])/g;

  function hash32(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }
  const rnd = key => hash32(key) / 4294967296;

  function applyCase(src, res) {
    if (!res) return res;
    const letters = src.replace(/[^А-Яа-яЁёA-Za-z]/g, '');
    if (letters.length > 1 && letters === letters.toUpperCase()) return res.toUpperCase();
    if (src[0] !== src[0].toLowerCase()) return res[0].toUpperCase() + res.slice(1);
    return res;
  }

  /* ---------- уровни ---------- */
  // доля применимых единиц (слово/фраза, у которых есть что менять), выбираемых по seed
  const DENSITY = { 1: .15, 2: .25, 3: .35, 4: .47, 5: .6, 6: .7, 7: .8, 8: .88, 9: .95, 10: 1, 12: 1 };
  const MERGE = { 8: .4, 9: .7, 10: .9, 12: 1 };     // слитное написание «нихачу» — только 8+
  const DOUBLE = { 10: .7, 12: 1 };                  // удвоение на конце «-афф» — 10 и 12/10
  function levelCfg(level) {
    let l = Math.round(+level) || 5;
    l = l >= 12 ? 12 : Math.max(1, Math.min(10, l));
    return { level: l, p: DENSITY[l], merge: MERGE[l] || 0, dbl: DOUBLE[l] || 0, max: l === 12 };
  }

  /* ---------- словарь ударений (StressRNN/Зализняк): строки «слово с + после ударной гласной», отсортированы ---------- */
  let SW = [], SS = new Int8Array(0);
  function setStress(text) {
    const lines = String(text).split('\n');
    const w = new Array(lines.length), s = new Int8Array(lines.length);
    let n = 0;
    for (const line of lines) {
      const p = line.indexOf('+');
      if (p <= 0) continue;
      w[n] = line.slice(0, p) + line.slice(p + 1); s[n] = p - 1; n++;
    }
    SW = w.slice(0, n); SS = s.slice(0, n);
    return n;
  }
  const stressLoaded = () => SW.length > 0;
  function lb(x) { let lo = 0, hi = SW.length; while (lo < hi) { const m = (lo + hi) >> 1; if (SW[m] < x) lo = m + 1; else hi = m; } return lo; }

  // неизвестная словоформа: берём ударение у однокоренных слов, если оно лежит внутри общей основы и они согласны
  function guessStress(w) {
    const n = w.length;
    for (let cut = 1; cut <= 3; cut++) {
      const sl = n - cut;
      if (sl < (cut > 2 ? 5 : 3)) break;
      const stem = w.slice(0, sl);
      let inside = 0, outside = 0; const votes = {};
      for (let i = lb(stem), seen = 0; i < SW.length && seen < 80 && SW[i].startsWith(stem); i++, seen++) {
        if (SW[i].length > n + 2) continue;
        if (SS[i] < sl) { inside++; votes[SS[i]] = (votes[SS[i]] || 0) + 1; } else outside++;
      }
      if (inside && inside >= 2 * outside) {
        let best = -1, bc = 0;
        for (const k in votes) if (votes[k] > bc) { bc = votes[k]; best = +k; }
        if (bc >= 0.75 * inside && isV(w[best])) return best;
      }
    }
    return -1;
  }

  function stressOf(w) {
    const e = w.indexOf('ё'); if (e >= 0) return e;
    let cnt = 0, last = -1;
    for (let i = 0; i < w.length; i++) if (isV(w[i])) { cnt++; last = i; }
    if (cnt === 0) return -1;
    if (cnt === 1) return last;
    if (!SW.length) return -1;
    const i = lb(w);
    if (SW[i] === w) return SS[i];
    return w.length >= 5 ? guessStress(w) : -1;
  }

  /* ---------- словари слов и фраз (ключи без ё) ---------- */
  const WORDS = {};
  function addW(forms, ...outs) { for (const f of forms.split(' ')) WORDS[norm(f)] = outs; }
  addW('привет', 'превед');
  addW('медведь', 'медвед');
  addW('автор', 'аффтар'); addW('автора', 'аффтара'); addW('автору', 'аффтару'); addW('автором', 'аффтаром');
  addW('авторы', 'аффтары'); addW('авторов', 'аффтарафф');
  addW('зачёт', 'зачот'); addW('зачёта', 'зачота'); addW('незачёт', 'низачот'); addW('незачёта', 'низачота');
  addW('жжёшь', 'жжош'); addW('жжёт', 'жжот'); addW('жжём', 'жжом'); addW('жжёте', 'жжоте');
  addW('красавчик', 'кросафчег'); addW('красавчика', 'кросафчега'); addW('красавчики', 'кросафчеги'); addW('красавчиков', 'кросафчегафф');
  addW('креатив', 'креатифф'); addW('креатива', 'креатива'); addW('позитив', 'пазитифф'); addW('позитива', 'пазитива');
  addW('комментарий коммент комменты', 'камент'); addW('комментарии', 'каменты'); addW('комментария', 'камента');
  addW('комментарию', 'каменту'); addW('комментариев комментов', 'каментафф');
  addW('фото', 'фотко');
  addW('что', 'што', 'шта'); addW('чтобы', 'штобы'); addW('чтоб', 'штоб'); addW('ничто', 'ништо');
  addW('конечно', 'канешна'); addW('сейчас', 'щас'); addW('ещё', 'исчо'); addW('тоже', 'тожы');
  addW('человек', 'чилавег'); addW('человека', 'чилавека'); addW('человеку', 'чилавеку'); addW('человеком', 'чилавеком');
  addW('человеков', 'чилавекафф');
  addW('язык', 'йазыг'); addW('языка', 'йазыка'); addW('языку', 'йазыку'); addW('языком', 'йазыком');
  addW('языки', 'йазыки'); addW('языков', 'йазыкафф');
  addW('албанский', 'олбанскей'); addW('албанского', 'олбанскава'); addW('албанскому', 'олбанскаму');
  addW('албанском', 'олбанскам'); addW('албанским', 'олбанскым'); addW('албанская', 'олбанская');
  addW('албанские', 'олбанские'); addW('албанских', 'олбанских'); addW('албанскую', 'олбанскую'); addW('албанское', 'олбанскае');
  addW('адский', 'аццкий'); addW('адская', 'аццкая'); addW('адское', 'аццкае'); addW('адские', 'аццкие');
  addW('адского', 'аццкава'); addW('адских', 'аццких'); addW('адскую', 'аццкую');
  addW('сатана', 'сотона'); addW('сатаны', 'сотоны'); addW('сатану', 'сотону'); addW('сатаной', 'сотоной');
  addW('ничего', 'ничиво'); addW('чего', 'чиво'); addW('его', 'ево', 'иво'); addW('кого', 'каво');
  addW('чему', 'чиму'); addW('ничему', 'ничиму');
  addW('сегодня', 'севодня'); addW('хочу', 'хачу'); addW('хочешь', 'хочеш'); addW('хочет', 'хочит');
  addW('поцелуй', 'чмоке'); addW('креветка', 'креведко');
  addW('я', 'йа'); addW('её', 'ейо');
  addW('пожалуйста', 'пажалуста'); addW('здравствуйте', 'здрасте', 'драсте'); addW('очень', 'очинь'); addW('вообще', 'ваще');
  addW('пиши', 'пеши'); addW('пишите', 'пешыте'); addW('писать', 'песать'); addW('писал', 'песал');
  addW('напиши', 'напеши'); addW('напишите', 'напешыте');
  addW('бог', 'бох');
  addW('что-то', 'чота'); addW('что-нибудь', 'чонить'); addW('кто-то', 'кто-та'); addW('как-то', 'как-та');
  addW('где-то', 'где-та'); addW('куда-то', 'куда-та'); addW('когда-то', 'когда-та');

  // фразы: ключ — слова через пробел; значение null = оставить как есть (канон)
  const PHRASES = {};
  function addP(src, out) { PHRASES[norm(src)] = out; }
  addP('ржу не могу', 'ржунимагу'); addP('под столом', 'пацталом');
  addP('убей себя об стену', 'убейся апстену'); addP('убейся об стену', 'убейся апстену');
  addP('выпей яду', 'выпей йаду'); addP('в топку', 'ффтопку');
  addP('не осилил', 'ниасилил'); addP('не осилила', 'ниасилила'); addP('не осилили', 'ниасилили'); addP('не осилю', 'ниасилю');
  addP('много букв', 'многабукаф');
  addP('автор жжёт', 'аффтар жжот');
  addP('пиши ещё', 'пеши исчо'); addP('пишите ещё', 'пешыте исчо'); addP('жги ещё', 'жги исчо');
  addP('как бы', 'кагбе'); addP('учи матчасть', null); addP('в бобруйск', null);
  addP('ни за что', 'ни за што'); addP('за что', 'за што'); addP('что за', 'шта за');
  addP('потому что', 'патамушта'); addP('так себе', 'таг сибе'); addP('ничего себе', 'ничиво сибе');
  addP('привет медведь', 'превед медвед');
  addP('не хочу', 'нихачу'); addP('не могу', 'нимагу'); addP('не буду', 'нибуду'); addP('не понял', 'нипонял'); addP('не знаю', 'низнаю');
  addP('на счёт', 'нащот'); addP('об стену', 'апстену'); addP('всё равно', 'фсё равно');
  const PH_FIRST = {};
  for (const k of Object.keys(PHRASES)) { const ws = k.split(' '); (PH_FIRST[ws[0]] || (PH_FIRST[ws[0]] = [])).push(ws); }
  for (const k in PH_FIRST) PH_FIRST[k].sort((a, b) => b.length - a.length);

  const CLITIC = { не: 'ни', по: 'па', до: 'да', от: 'ат', об: 'аб', обо: 'аба', со: 'са', во: 'ва', ко: 'ка', про: 'пра', под: 'пад', без: 'биз', же: 'жы' };
  const NOT_GEN = new Set(['много', 'немного', 'намного', 'строго', 'дорого', 'убого', 'долго', 'недорого', 'нестрого', 'недолго', 'иного', 'мало']);
  const CHN = /(конечн|скучн|нарочн|яичниц|скворечн|прачечн|горчичн)/;
  const VERBISH = /(?:ть|ться|ти|чь|ю|ешь|ет|ем|ете|ут|ют|ит|им|ите|ат|ят|ся|сь|ла|ло|ли|ил|ел|ал|ул|ыл|ол|ёл|ёшь|ёт|ёте|ём)$/;

  /* ---------- фонетика одного слова (строчные кириллические буквы) ---------- */
  const DEVOICE = { б: 'п', в: 'ф', г: 'к', д: 'т', ж: 'ш', з: 'с' };
  const IOT = { я: 'а', ё: 'о', ю: 'у' };

  function phon(w, st, V, o) {
    const a = w.split(''), n = a.length;
    let nv = 0; for (const c of a) if (isV(c)) nv++;
    // окончание -ого/-ео: «г» читается как «в»
    let gen = '';
    if (n >= 5 && /[ое]го$/.test(w) && !NOT_GEN.has(w)) { gen = w[n - 3]; a[n - 2] = 'в'; }
    // редукция гласных — только при известном ударении
    if (st >= 0 && nv >= 2) {
      for (let i = 0; i < n; i++) {
        if (i === st) continue;
        const c = a[i];
        if (c === 'о') a[i] = 'а';
        else if ((c === 'е' || c === 'я') && i < st && i > 0 && isCons(a[i - 1])) a[i] = 'и';
      }
    }
    if (gen) {
      const unstressedEnd = st < 0 || st < n - 3;
      if (unstressedEnd) a[n - 3] = gen === 'е' ? 'и' : 'а';
      a[n - 1] = 'а';
    }
    let s = a.join('');
    s = s.replace(/([жшчщ])ё/g, '$1о');
    if (CHN.test(w)) s = s.replace(/чн/g, 'шн');
    // -ться / -тся
    s = s.replace(/ться$/, () => { const r = V('ts'); return r < .6 ? 'цца' : r < .85 ? 'ца' : 'ццо'; });
    s = s.replace(/тся$/, () => V('ts') < .5 ? 'ца' : 'цца');
    // стечения согласных, которые не произносятся
    s = s.replace(/вств/g, 'ств').replace(/стн/g, 'сн').replace(/здн/g, 'зн').replace(/стл/g, 'сл')
      .replace(/лнц/g, 'нц').replace(/рдц/g, 'рц').replace(/[тд]ск/g, 'цк').replace(/жч/g, 'щ');
    if (V('sch') < .7) s = s.replace(/сч/g, 'щ');
    // оглушение перед глухими и озвончение перед звонкими
    s = s.replace(/г(?=[кч])/g, 'х');
    s = s.replace(/[бвгджз](?=[кпстфхцчшщ])/g, c => DEVOICE[c]);
    if (V('voice') < .8) s = s.replace(/с(?=[бгдзж])/g, 'з').replace(/к(?=[бгдзж])/g, 'г');
    s = s.replace(/([бвгджз])(ь?)$/, (m, c, b) => DEVOICE[c] + b);
    // жи/ши, ци, ча/ща, чу/щу
    s = s.replace(/([жш])и/g, '$1ы');
    s = s.replace(/ци/g, V('tsi') < .8 ? 'цы' : 'ци');
    s = s.replace(/([чщ])а/g, '$1я').replace(/([чщ])у/g, '$1ю');
    // -ик/-ек/-ок → -иг/-ег/-ог (на конце всё равно оглушается)
    if (n >= 5 && /[аеиоуыэюя]к$/.test(s) && V('kg') < .6) s = s.slice(0, -1) + 'г';
    // йотация: слово на я/ё/ю и после гласной
    s = s.replace(/^[яёю]/, c => 'й' + IOT[c]);
    if (V('iot') < .85) s = s.replace(/([аоуыэи])([яёю])/g, (m, v, c) => v + 'й' + IOT[c]);
    // безударное -ати на конце → -ате («кстате»)
    if (st >= 0 && /ати$/.test(w) && st < n - 2 && V('te') < .3) s = s.slice(0, -1) + 'е';
    // удвоение «-афф» (10 и 12/10)
    if (o.dbl && /[аеиоуыэюя]ф$/.test(s) && V('dbl') < o.dbl) s += 'ф';
    return s;
  }

  /* ---------- слово целиком: словарь → клитики → правила ---------- */
  function wordForm(raw, ctx) {
    const low = raw.toLowerCase(), key = norm(low), V = ctx.V;
    const dict = WORDS[key];
    if (dict) return dict[dict.length > 1 ? Math.floor(V('dict') * dict.length) : 0];
    if (ctx.general === false) return low;
    if (CLITIC[key]) return CLITIC[key];
    if (key.length === 1) {
      const nx = ctx.nextCh;
      if (key === 'в' && nx && 'кпстфхцчшщ'.includes(nx)) return 'ф';
      if ((key === 'с' || key === 'к') && nx && 'бгдзж'.includes(nx)) return key === 'с' ? 'з' : 'г';
      return low;
    }
    if (low.indexOf('-') >= 0) return low.split('-').map(p => (WORDS[norm(p)] ? WORDS[norm(p)][0] : CLITIC[norm(p)] || phon(p, stressOf(p), ctx.V, ctx.o))).join('-');
    return phon(low, stressOf(low), V, ctx.o);
  }

  /* ---------- перевод текста ---------- */
  const ONE_SPACE = /^[ \t ]$/;
  function translateEx(text, opts) {
    opts = opts || {};
    const seed = String(opts.seed === undefined ? 0 : opts.seed), cfg = levelCfg(opts.level);
    const toks = [];
    TOK.lastIndex = 0;
    let m;
    while ((m = TOK.exec(text))) toks.push({ t: m[0], word: !!m[2] && RU_WORD.test(m[0]), sp: !!m[3] });
    const out = [], units = [];
    let atStart = true;
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (!tk.word) {
        out.push(tk.t);
        if (tk.sp) { if (tk.t.indexOf('\n') >= 0) atStart = true; }
        else atStart = /^[.!?…]$/.test(tk.t) ? true : (/^[("«\[—–-]$/.test(tk.t) ? atStart : false);
        continue;
      }
      const raw = tk.t, wasStart = atStart; atStart = false;
      const V = k => rnd(seed + '|' + k + '|' + i + '|' + raw);
      const pick = V('u') < cfg.p;
      const letters = raw.replace(/-/g, '');
      const allCaps = letters.length > 1 && letters === letters.toUpperCase();
      const cap = raw[0] !== raw[0].toLowerCase() && !allCaps;
      const general = !((cap && !wasStart) || (allCaps && letters.length < 3));
      const nxt = toks[i + 1], nxt2 = toks[i + 2];
      const gap = nxt && nxt.sp && ONE_SPACE.test(nxt.t) && nxt2 && nxt2.word ? nxt2 : null;
      const ctx = { V, o: cfg, general, nextCh: gap ? gap.t[0].toLowerCase() : '' };

      // 1) фразы
      let done = false;
      const cands = PH_FIRST[norm(raw.toLowerCase())];
      if (cands) {
        for (const ws of cands) {
          let j = i, ok = true;
          for (let k = 0; k < ws.length; k++) {
            if (k) { if (!(toks[j + 1] && toks[j + 1].sp && ONE_SPACE.test(toks[j + 1].t))) { ok = false; break; } j += 2; }
            if (!(toks[j] && toks[j].word && norm(toks[j].t.toLowerCase()) === ws[k])) { ok = false; break; }
          }
          if (!ok) continue;
          const span = toks.slice(i, j + 1).map(x => x.t).join('');
          const res = PHRASES[ws.join(' ')];
          if (res !== null && res !== undefined && pick) {
            out.push(applyCase(raw, span === span.toUpperCase() && span.length > 2 ? res.toUpperCase() : res));
            units.push({ i, from: span, to: out[out.length - 1] });
          } else out.push(span);
          i = j; done = true; break;
        }
        if (done) continue;
      }

      // 2) слитное «не/ни + глагол» (8+)
      if (cfg.merge && general && norm(raw.toLowerCase()) === 'не' && gap && pick && V('merge') < cfg.merge && VERBISH.test(gap.t.toLowerCase()) && !WORDS[norm(gap.t.toLowerCase())]) {
        const w2 = gap.t, V2 = k => rnd(seed + '|' + k + '|' + (i + 2) + '|' + w2);
        const g2 = !(w2[0] !== w2[0].toLowerCase() && w2 !== w2.toUpperCase());
        if (g2) {
          const res = 'ни' + wordForm(w2, { V: V2, o: cfg, general: true, nextCh: '' });
          out.push(applyCase(raw, res)); units.push({ i, from: raw + ' ' + w2, to: out[out.length - 1] });
          i += 2; continue;
        }
      }
      // 3) слитное «в/с/к + слово» (только 12/10)
      if (cfg.max && general && gap && raw.length === 1 && /[вск]/i.test(raw) && !cap) {
        const f = wordForm(raw, ctx);
        if (f !== raw.toLowerCase()) {
          const w2 = gap.t, V2 = k => rnd(seed + '|' + k + '|' + (i + 2) + '|' + w2);
          out.push(f + wordForm(w2, { V: V2, o: cfg, general: true, nextCh: '' }));
          units.push({ i, from: raw + ' ' + w2, to: out[out.length - 1] });
          i += 2; continue;
        }
      }

      // 4) одиночное слово
      const form = wordForm(raw, ctx);
      const res = applyCase(raw, form);
      if (res !== raw && pick) { out.push(res); units.push({ i, from: raw, to: res }); } else out.push(raw);
    }
    return { text: out.join(''), units };
  }
  function translate(text, opts) { return translateEx(text, opts).text; }

  /* ---------- «Расшифровать» ---------- */
  // точно: если известен исходник и перевод по тем же seed/level совпал с тем, что на экране
  function decode(out, src, opts) { return src && translate(src, opts) === out ? src : null; }

  // примерно: без исходника — обратный ход по словарям и по самым однозначным правилам
  const REV_W = {}, REV_P = [];
  for (const k of Object.keys(WORDS)) for (const o of WORDS[k]) if (!(o in REV_W) && o !== k) REV_W[o] = k;
  REV_W['превед'] = 'привет'; REV_W['исчо'] = 'ещё'; REV_W['йа'] = 'я'; REV_W['ейо'] = 'её'; REV_W['жжот'] = 'жжёт'; REV_W['жжош'] = 'жжёшь';
  for (const k of Object.keys(PHRASES)) if (PHRASES[k] !== null) REV_P.push([PHRASES[k], k]);
  REV_P.sort((a, b) => b[0].length - a[0].length);
  function reverse(text) {
    let s = text;
    for (const [from, to] of REV_P) s = s.replace(new RegExp('(^|[^А-Яа-яЁё])' + from + '(?![А-Яа-яЁё])', 'gi'), (m, pre) => pre + to);
    TOK.lastIndex = 0;
    return s.replace(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g, w => {
      const lw = w.toLowerCase();
      let r = REV_W[lw];
      if (!r) {
        r = lw.replace(/чя/g, 'ча').replace(/чю/g, 'чу').replace(/щя/g, 'ща').replace(/щю/g, 'щу').replace(/жы/g, 'жи').replace(/шы/g, 'ши')
          .replace(/цы/g, 'ци').replace(/цца$/, 'ться').replace(/ца$/, 'тся').replace(/^й([аоу])/, (m, v) => ({ а: 'я', о: 'ё', у: 'ю' })[v])
          .replace(/([аоуыэи])й([аоу])/g, (m, v, c) => v + ({ а: 'я', о: 'ё', у: 'ю' })[c]).replace(/ффт/g, 'вт').replace(/([аеиоуыэюя])фф$/, '$1в');
      }
      return applyCase(w, r);
    });
  }

  return { translate, translateEx, decode, reverse, setStress, stressLoaded, stressOf, hash32, levelCfg, VERSION: 1 };
});
