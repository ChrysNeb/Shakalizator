// Шакалография: интерфейс. Ни фраза, ни текст нигде не сохраняются (ни storage, ни URL, ни логи).
import {
  MAX_CHARS, LEVEL_1210, ERR_DECRYPT, b64uEncode, b64uDecode, wordIndex, generatePhrase, inspectPhrase,
  encodeSkin, decodeSkin, detectLevel, looksLikeLink, PNG_BANNER_H, packToImage, unpackFromImage,
} from './core.js';

const $ = (id) => document.getElementById(id);
const HOME = 'https://crypto.shakalizator.space/';
const WEAK = 'Самодельная фраза, шакалы слабее';

const [wordlist, skins] = await Promise.all([
  fetch('/crypto/wordlist.json').then(r => r.json()),
  fetch('/crypto/skins.json').then(r => r.json()),
]);
const idx = wordIndex(wordlist);

/* ---------- воркер: PBKDF2 не должен фризить интерфейс ---------- */
const worker = new Worker('/crypto/worker.js', { type: 'module' });
let seq = 0; const pending = new Map();
worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); data.ok ? p.res(data) : p.rej(new Error(data.error)); };
const call = (msg) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); worker.postMessage({ ...msg, id }); });

/* ---------- уровни ---------- */
const state = { E: 6, D: 6 };          // 12 = «12/10»
const lvlText = (n) => n === LEVEL_1210 ? '12/10' : n + ' ' + (n === 1 ? 'шакал' : n < 5 ? 'шакала' : 'шакалов');
function setLevel(side, n) {
  state[side] = n;
  const r = $('lvl' + side), is = n === LEVEL_1210;
  if (!is) r.value = n;
  $('lbl' + side).textContent = lvlText(n);
  const b = $(side === 'E' ? 'e1210' : 'd1210'); b.classList.toggle('on', is); b.setAttribute('aria-pressed', is);
  if (side === 'D') $('pngRow').classList.toggle('hidden', !is);
}
for (const s of ['E', 'D']) {
  $('lvl' + s).addEventListener('input', (e) => setLevel(s, +e.target.value));
  $(s === 'E' ? 'e1210' : 'd1210').addEventListener('click', () => setLevel(s, state[s] === LEVEL_1210 ? +$('lvl' + s).value : LEVEL_1210));
}

/* ---------- фраза ---------- */
let count = 12;
async function newPhrase() { $('phrase').value = (await generatePhrase(count, idx)).join(' '); showPhraseStatus('phrase', 'phraseStatus'); }
async function showPhraseStatus(inputId, statusId) {
  const el = $(statusId), v = $(inputId).value;
  if (!v.trim()) { el.textContent = ''; el.className = 'note'; return null; }
  const r = await inspectPhrase(v, idx);
  if (r.standard) { el.textContent = `✔ Настоящая шакал-фраза, ${r.count} слов, контрольная сумма сошлась`; el.className = 'okmsg'; }
  else { el.textContent = '⚠ ' + WEAK + (r.unknown.length ? ` (слов не из словаря: ${r.unknown.length})` : r.count !== 12 && r.count !== 24 ? ` (слов: ${r.count})` : ' (контрольная сумма не сошлась)'); el.className = 'warnbox'; }
  return r;
}
function setCount(n) {
  count = n; $('n12').classList.toggle('on', n === 12); $('n24').classList.toggle('on', n === 24);
  $('n12').setAttribute('aria-pressed', n === 12); $('n24').setAttribute('aria-pressed', n === 24); newPhrase();
}
$('n12').addEventListener('click', () => setCount(12));
$('n24').addEventListener('click', () => setCount(24));
$('newPhrase').addEventListener('click', newPhrase);
$('phrase').addEventListener('input', () => showPhraseStatus('phrase', 'phraseStatus'));

async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); } catch {} t.remove(); }
  flash(label);
}
function flash(el, msg = 'Скопировано') { el.textContent = msg; clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = ''; }, 2500); }
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
$('copyPhrase').addEventListener('click', () => copy($('phrase').value.trim(), $('phraseStatus')));
$('dlPhrase').addEventListener('click', () => download('shakal-phrase.txt', new Blob([$('phrase').value.trim() + '\n'], { type: 'text/plain;charset=utf-8' })));

/* ---------- автокомплит по префиксу ---------- */
function suggest(inputId) {
  const v = $(inputId).value, m = /([а-яёА-ЯЁ]{2,})$/.exec(v), box = $('sugg');
  box.textContent = '';
  if (!m) return;
  const p = m[1].toLowerCase().replace(/ё/g, 'е');
  const hits = wordlist.filter(w => w.startsWith(p) && w !== p).slice(0, 6);
  for (const w of hits) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = w;
    b.addEventListener('click', () => { const el = $(inputId); el.value = v.slice(0, v.length - m[1].length) + w + ' '; el.focus(); box.textContent = ''; showPhraseStatus(inputId, 'phraseDStatus'); });
    box.append(b);
  }
}
$('phraseD').addEventListener('input', () => { showPhraseStatus('phraseD', 'phraseDStatus'); suggest('phraseD'); });

/* ---------- шифрование ---------- */
const busy = (side, on) => { $('think' + side).classList.toggle('on', on); $(side === 'E' ? 'encBtn' : 'decBtn').disabled = on; };
let lastPacket = null;
$('msg').addEventListener('input', () => { $('msgCount').textContent = $('msg').value.length; });
$('encBtn').addEventListener('click', async () => {
  const err = $('errE'); err.textContent = '';
  const info = await inspectPhrase($('phrase').value, idx);
  if (!info.count) { err.textContent = 'Нужна шакал-фраза: нажмите «Новая фраза»'; return; }
  const text = $('msg').value;
  if (text.length > MAX_CHARS) { err.textContent = `Максимум ${MAX_CHARS} символов`; return; }
  busy('E', true);
  try {
    const { packet } = await call({ op: 'enc', phrase: info.phrase, level: state.E, text });
    lastPacket = packet;
    $('outE').value = encodeSkin(packet, state.E, skins);
    $('lenE').textContent = `${$('outE').value.length} символов шифротекста`;
    $('pngE').classList.toggle('hidden', state.E !== LEVEL_1210);
    $('resE').classList.remove('hidden');
  } catch (e) { err.textContent = e.message; }
  busy('E', false);
});
$('copyE').addEventListener('click', () => copy($('outE').value, $('okE')));
$('shareE').addEventListener('click', async () => {
  if (!lastPacket) return;
  const url = HOME + '#m=' + b64uEncode(lastPacket);
  if (navigator.share) { try { await navigator.share({ url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copy(url, $('okE')); flash($('okE'), 'Ссылка скопирована. Фразу и шакалов передайте отдельно');
});
$('pngE').addEventListener('click', () => {
  if (!lastPacket) return;
  const { width, rows, data } = packToImage(lastPacket);
  const c = document.createElement('canvas'); c.width = width; c.height = PNG_BANNER_H + rows;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#0f1115'; g.fillRect(0, 0, width, PNG_BANNER_H);
  g.fillStyle = '#f5a524'; g.font = 'bold 18px sans-serif'; g.textBaseline = 'middle'; g.fillText('🐺 ШАКАЛОГРАФИЯ 12/10', 8, PNG_BANNER_H / 2);
  g.putImageData(new ImageData(data, width, rows), 0, PNG_BANNER_H);
  c.toBlob((b) => download('shakal-12-10.png', b), 'image/png');
});

/* ---------- расшифровка ---------- */
function extractLink(s) { const m = /#m=([A-Za-z0-9_-]+)/.exec(s); return m ? m[1] : s.trim(); }
$('cipher').addEventListener('input', () => {
  const t = $('cipher').value, d = $('detect'); d.textContent = '';
  if (looksLikeLink(extractLink(t)) || /#m=/.test(t)) return;
  const lv = detectLevel(t, skins);
  if (lv) { setLevel('D', lv); d.textContent = 'Похоже на ' + lvlText(lv) + ' — выставлено само'; }
});
$('decBtn').addEventListener('click', async () => {
  const err = $('errD'); err.textContent = ''; $('resD').classList.add('hidden');
  const info = await inspectPhrase($('phraseD').value, idx);
  if (!info.count) { err.textContent = ERR_DECRYPT; return; }
  busy('D', true);
  try {
    const raw = $('cipher').value, link = extractLink(raw);
    let packet;
    if (/#m=/.test(raw) || looksLikeLink(link)) packet = b64uDecode(link);
    else packet = decodeSkin(raw, state.D, skins);
    const { text } = await call({ op: 'dec', phrase: info.phrase, level: state.D, packet });
    $('outD').textContent = text; $('resD').classList.remove('hidden');
  } catch { err.textContent = ERR_DECRYPT; }
  busy('D', false);
});
$('copyD').addEventListener('click', () => copy($('outD').textContent, $('okD')));

$('pngIn').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return; const msg = $('pngMsg'); msg.textContent = '';
  try {
    const bmp = await createImageBitmap(f);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height);
    const packet = unpackFromImage(px.data, c.width, c.height);
    $('cipher').value = '#m=' + b64uEncode(packet); setLevel('D', LEVEL_1210); msg.textContent = 'Шакалы вынули пакет из картинки';
  } catch { msg.textContent = 'Это не шакал-картинка или она повреждена'; }
});

/* ---------- ссылка #m=… ---------- */
const hm = /^#m=([A-Za-z0-9_-]+)$/.exec(location.hash);
if (hm) {
  $('cipher').value = hm[1];
  history.replaceState(null, '', location.pathname + location.search);
  $('phraseD').focus();
}

await newPhrase();
document.body.dataset.ready = '1';
