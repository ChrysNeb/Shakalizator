// DSD256: PCM (WAV s16le) → полифазный ресемплинг → ×256 каскадом FIR (×4 ×4 ×4 ×4) → 1-бит ΣΔ 5-го порядка → DSF.
// Чистый JS без DOM: работает в Web Worker, Node и (для тестов) в браузере. Всё потоково: блок = 2048 отсчётов базовой частоты
// = 524288 DSD-отсчётов = 65536 байт на канал = 16 блоков DSF по 4096 байт.

export const FAMILIES = { 44: { base: 44100, dsd: 11289600 }, 48: { base: 48000, dsd: 12288000 } };
export const BLOCK = 4096;                 // байт на канал в блоке DSF
export const BASE_BLOCK = 2048;            // отсчётов базовой частоты за один шаг конвейера
export const UP = 256;                     // 4 × 4 × 4 × 4
export const HEADER_BYTES = 92;            // DSD (28) + fmt (52) + data-заголовок (12)
export const NTF_HINF = 1.2;               // max|NTF|: при 1.5 модулятор срывается уже на 0,7 FS
export const PAD_BYTE = 0x69;              // тишина DSD
export const INPUT_GAIN = 0.6;             // ≈ −4,4 dBFS: запас для устойчивости 1-битного модулятора
const OUT_CLIP = 0.75;                     // жёсткий предел перед квантователем
const ATT_DB = 110;                        // подавление в полосе задерживания FIR
const BAND = 0.45;                         // верхняя граница полезной полосы, доля от базовой частоты

/* ---------- расчёт фильтров ---------- */
function i0(x) { let s = 1, t = 1; for (let k = 1; k < 200; k++) { t *= (x / (2 * k)) ** 2; s += t; if (t < 1e-14 * s) break; } return s; }
function kaiserBeta(a) { return a > 50 ? 0.1102 * (a - 8.7) : a > 21 ? 0.5842 * (a - 21) ** 0.4 + 0.07886 * (a - 21) : 0; }
// Фазо-мажорная таблица: H[p*T + t] = h[p + L*t] · L, где h — Kaiser-ФНЧ длиной L·T на частоте L·fs_in.
// fc — частота среза в долях от выходной частоты (циклов/отсчёт); df — ширина перехода в тех же долях.
function designPolyphase(L, fp, fstop, rateOut) {
  const df = (fstop - fp) / rateOut, fc = (fp + fstop) / 2 / rateOut;
  const T = Math.max(4, Math.ceil(Math.ceil((ATT_DB - 7.95) / (14.36 * df)) / L));
  const N = L * T, c = (N - 1) / 2, beta = kaiserBeta(ATT_DB), ib = i0(beta), H = new Float64Array(N);
  for (let p = 0; p < L; p++) for (let t = 0; t < T; t++) {
    const n = p + L * t, x = n - c, r = 2 * x / (N - 1);
    const w = i0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / ib;
    const s = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    H[p * T + t] = s * w * L;
  }
  return { H, T, L, delay: (N - 1) / 2 / L };         // delay — в отсчётах входной частоты
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/* ---------- целочисленный интерполятор (поток) ---------- */
class Interp {
  constructor(L, rateIn, band) {
    const d = designPolyphase(L, band, rateIn - band, rateIn * L);
    Object.assign(this, d);
    this.buf = null; this.n = 0;
  }
  prepare(n) { this.n = n; this.buf = new Float64Array(this.T - 1 + n); }
  process(x, out) {
    const { H, T, L, buf } = this, n = x.length;
    buf.copyWithin(0, n, n + T - 1);                  // хвост предыдущего блока → начало
    buf.set(x, T - 1);
    for (let i = 0; i < n; i++) {
      const top = i + T - 1;
      for (let p = 0; p < L; p++) {
        let acc = 0; const o = p * T;
        for (let t = 0; t < T; t++) acc += H[o + t] * buf[top - t];
        out[i * L + p] = acc;
      }
    }
  }
}

/* ---------- рациональный ресемплер L/M (поток) ---------- */
class Resampler {
  constructor(rateIn, rateOut) {
    const g = gcd(rateIn, rateOut); this.L = rateOut / g; this.M = rateIn / g;
    const lo = Math.min(rateIn, rateOut);
    const d = designPolyphase(this.L, BAND * lo, (1 - BAND) * lo, rateIn * this.L);
    this.H = d.H; this.T = d.T; this.delay = d.delay;   // в отсчётах входа
    this.carry = new Float64Array(this.T - 1); this.inBase = -(this.T - 1); this.nOut = 0;
    this.ratio = rateOut / rateIn;
  }
  process(x) {
    const { H, T, L, M } = this;
    const buf = new Float64Array(this.carry.length + x.length); buf.set(this.carry); buf.set(x, this.carry.length);
    const bufStart = this.inBase, last = bufStart + buf.length - 1;
    const out = new Float64Array(Math.ceil(x.length * L / M) + 2); let k = 0;
    for (;;) {
      const nm = this.nOut * M, i = Math.floor(nm / L);
      if (i > last) break;
      const idx = i - bufStart, o = (nm - i * L) * T;
      let acc = 0; for (let t = 0; t < T; t++) acc += H[o + t] * buf[idx - t];
      out[k++] = acc; this.nOut++;
    }
    const next = Math.floor(this.nOut * M / L), keepFrom = next - (T - 1) - bufStart;
    this.carry = buf.slice(keepFrom); this.inBase = next - (T - 1);
    return out.subarray(0, k);
  }
}

/* ---------- ΣΔ-модулятор 5-го порядка (IIR-NTF в форме error-feedback) ---------- */
// NTF(z) = B(z)/A(z): нули — на единичной окружности (оптимальные по Лежандру, полоса π/OSR), полюса — Баттерворт ФВЧ,
// частота среза подобрана так, чтобы max|NTF| = Hinf (критерий Ли ≈1.5, на практике для 1 бита берём запас — см. NTF_HINF).
export function designNTF(order = 5, osr = 256, hinf = 1.5) {
  const legendre = { 5: [0, 0.5384693101056831, 0.9061798459386640] }[order];
  const zeros = []; // комплексные нули
  for (const x of legendre) { const w = Math.PI * x / osr; if (x === 0) zeros.push([1, 0]); else { zeros.push([Math.cos(w), Math.sin(w)], [Math.cos(w), -Math.sin(w)]); } }
  const polyFrom = (roots) => { let p = [[1, 0]]; for (const [rr, ri] of roots) { const q = new Array(p.length + 1).fill(0).map(() => [0, 0]); for (let i = 0; i < p.length; i++) { q[i][0] += p[i][0]; q[i][1] += p[i][1]; q[i + 1][0] -= p[i][0] * rr - p[i][1] * ri; q[i + 1][1] -= p[i][0] * ri + p[i][1] * rr; } p = q; } return p.map(c => c[0]); };
  const B = polyFrom(zeros);
  const polesFor = (fc) => {            // Баттерворт ФВЧ порядка N, билинейно, fc — рад/отсчёт
    const W = Math.tan(fc / 2), ps = [];
    for (let k = 0; k < order; k++) {
      const th = Math.PI * (2 * k + order + 1) / (2 * order);             // полюса ФНЧ-прототипа в левой полуплоскости
      const sl = [Math.cos(th), Math.sin(th)], den = sl[0] * sl[0] + sl[1] * sl[1];
      const s = [W * sl[0] / den, W * sl[1] / den];                          // ФВЧ: s → W / s_lp
      const nr = 1 + s[0], ni = s[1], dr = 1 - s[0], di = -s[1], dd = dr * dr + di * di;
      ps.push([(nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd]);
    }
    return ps;
  };
  const evalMax = (A) => {
    let m = 0;
    for (let i = 1; i <= 6000; i++) {
      const w = Math.PI * Math.pow(10, -4 + 4 * i / 6000);
      const ev = (P) => { let re = 0, im = 0; for (let k = 0; k < P.length; k++) { re += P[k] * Math.cos(-w * k); im += P[k] * Math.sin(-w * k); } return Math.hypot(re, im); };
      m = Math.max(m, ev(B) / ev(A));
    }
    return m;
  };
  let lo = 1e-4, hi = 3.0, A = null;
  for (let it = 0; it < 60; it++) {                                   // чем выше fc, тем глубже подавление и выше Hinf
    const mid = Math.sqrt(lo * hi); A = polyFrom(polesFor(mid));
    if (evalMax(A) > hinf) hi = mid; else lo = mid;
  }
  A = polyFrom(polesFor(lo));
  return { b: B, a: A, hinf: evalMax(A) };
}

export class Modulator {
  constructor(ntf, opts = {}) {
    this.b = Float64Array.from(ntf.b); this.a = Float64Array.from(ntf.a);
    this.e = new Float64Array(5); this.d = new Float64Array(5);
    this.dither = opts.dither ?? 0.05; this.guard = opts.guard ?? 8; this.rng = (opts.seed ?? 0x9e3779b9) >>> 0 || 1;
    this.resets = 0; this.clipped = 0;
  }
  // u — входные отсчёты (|u| < 1), out — байты, LSB-first; u.length кратна 8
  process(u, out) {
    const b1 = this.b[1], b2 = this.b[2], b3 = this.b[3], b4 = this.b[4], b5 = this.b[5];
    const a1 = this.a[1], a2 = this.a[2], a3 = this.a[3], a4 = this.a[4], a5 = this.a[5];
    let [e1, e2, e3, e4, e5] = this.e, [d1, d2, d3, d4, d5] = this.d, s = this.rng; const dith = this.dither, guard = this.guard;
    const n = u.length;
    for (let k = 0; k < n; k += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        let x = u[k + j]; if (x > OUT_CLIP) x = OUT_CLIP; else if (x < -OUT_CLIP) x = -OUT_CLIP;
        const w = x + (b1 * e1 + b2 * e2 + b3 * e3 + b4 * e4 + b5 * e5) - (a1 * d1 + a2 * d2 + a3 * d3 + a4 * d4 + a5 * d5);
        if (!(w > -guard && w < guard)) {                      // нестабильность (или NaN): сбрасываем состояния
          e1 = e2 = e3 = e4 = e5 = d1 = d2 = d3 = d4 = d5 = 0; this.resets++;
          byte |= (x >= 0 ? 1 : 0) << j; continue;
        }
        s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; const r1 = s / 4294967296;
        s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; const r2 = s / 4294967296;
        const v = w + dith * (r1 + r2 - 1);                    // TPDF-дизер на входе квантователя
        const y = v >= 0 ? 1 : -1;
        const e = y - w, d = y - x;
        e5 = e4; e4 = e3; e3 = e2; e2 = e1; e1 = e;
        d5 = d4; d4 = d3; d3 = d2; d2 = d1; d1 = d;
        byte |= (y > 0 ? 1 : 0) << j;
      }
      out[k >> 3] = byte;
    }
    this.e.set([e1, e2, e3, e4, e5]); this.d.set([d1, d2, d3, d4, d5]); this.rng = s;
  }
}

/* ---------- конвейер одного канала ---------- */
export class Channel {
  constructor(rateIn, family, ntf, seed) {
    const F = FAMILIES[family]; this.base = F.base;
    this.rs = rateIn === F.base ? null : new Resampler(rateIn, F.base);
    this.stages = []; let rate = F.base;
    for (let i = 0; i < 4; i++) { const st = new Interp(4, rate, BAND * F.base); rate *= 4; this.stages.push(st); }
    this.sizes = [BASE_BLOCK]; for (let i = 0; i < 4; i++) this.sizes.push(this.sizes[i] * 4);
    this.bufs = this.sizes.map(n => new Float64Array(n));
    this.stages.forEach((st, i) => st.prepare(this.sizes[i]));
    this.mod = new Modulator(ntf, { seed });
    this.queue = new Float64Array(BASE_BLOCK * 2); this.qn = 0;
    // суммарная задержка в отсчётах базовой частоты
    let dl = this.rs ? this.rs.delay * F.base / rateIn : 0, r = F.base;
    for (const st of this.stages) { dl += st.delay * F.base / r; r *= 4; }
    this.delayBase = dl;
  }
  // x — отсчёты входной частоты (Float64Array, диапазон −1..1); возвращает массив готовых блоков по 65536 байт
  push(x) {
    const base = this.rs ? this.rs.process(x) : x, out = [];
    if (this.qn + base.length > this.queue.length) { const q = new Float64Array(this.qn + base.length + BASE_BLOCK); q.set(this.queue.subarray(0, this.qn)); this.queue = q; }
    this.queue.set(base, this.qn); this.qn += base.length;
    let off = 0;
    while (this.qn - off >= BASE_BLOCK) {
      const b0 = this.bufs[0]; for (let i = 0; i < BASE_BLOCK; i++) b0[i] = this.queue[off + i] * INPUT_GAIN;
      off += BASE_BLOCK;
      for (let s = 0; s < 4; s++) this.stages[s].process(this.bufs[s], this.bufs[s + 1]);
      if (this.tap) this.tap(this.bufs[4]);                    // только для тестов
      const bytes = new Uint8Array(this.bufs[4].length / 8); this.mod.process(this.bufs[4], bytes); out.push(bytes);
    }
    if (off) { this.queue.copyWithin(0, off, this.qn); this.qn -= off; }
    return out;
  }
}

/* ---------- упаковка блоков DSF ---------- */
class Packer {          // 64 КБ потока → блоки по 4096 байт; пропускает первые skip байт, обрезает по total, добивает 0x69
  constructor(skip, total) { this.skip = skip; this.left = total; this.cur = new Uint8Array(BLOCK); this.fill = 0; }
  feed(bytes) {
    const out = []; let i = 0;
    if (this.skip) { const s = Math.min(this.skip, bytes.length); this.skip -= s; i = s; }
    while (i < bytes.length && this.left > 0) {
      const n = Math.min(BLOCK - this.fill, bytes.length - i, this.left);
      this.cur.set(bytes.subarray(i, i + n), this.fill); this.fill += n; i += n; this.left -= n;
      if (this.fill === BLOCK) { out.push(this.cur); this.cur = new Uint8Array(BLOCK); this.fill = 0; }
    }
    return out;
  }
  done() { return this.left <= 0; }
  finish() { if (this.fill === 0) return []; this.cur.fill(PAD_BYTE, this.fill); const b = this.cur; this.fill = 0; return [b]; }
}

/* ---------- WAV ---------- */
export function wavInfo(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (u8.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('это не WAV');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= u8.length) {
    const id = tag(o); let sz = dv.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: dv.getUint16(o + 8, true), channels: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
    if (id === 'data') { if (o + 8 + sz > u8.length) sz = u8.length - o - 8; data = { offset: o + 8, size: sz }; break; }
    o += 8 + sz + (sz & 1);
  }
  if (!fmt || !data) throw new Error('в WAV нет fmt/data');
  if (fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1 || fmt.channels > 2) throw new Error('нужен PCM s16le, 1–2 канала');
  return { ...fmt, offset: data.offset, frames: Math.floor(data.size / (2 * fmt.channels)) };
}

/* ---------- заголовок DSF и оценка размера ---------- */
export function plan(frames, rateIn, family) {
  const F = FAMILIES[family], baseSamples = Math.round(frames * F.base / rateIn);
  const totalBytes = baseSamples * (UP / 8), blocks = Math.ceil(totalBytes / BLOCK);
  return { baseSamples, samples: baseSamples * UP, totalBytes, blocks, fileSize: HEADER_BYTES + 2 * blocks * BLOCK, dsdRate: F.dsd };
}
export function dsfHeader(p) {
  const h = new Uint8Array(HEADER_BYTES), dv = new DataView(h.buffer), str = (o, s) => { for (let i = 0; i < 4; i++) h[o + i] = s.charCodeAt(i); };
  const big = (o, v) => dv.setBigUint64(o, BigInt(v), true);
  str(0, 'DSD '); big(4, 28); big(12, p.fileSize); big(20, 0);
  str(28, 'fmt '); big(32, 52); dv.setUint32(40, 1, true); dv.setUint32(44, 0, true); dv.setUint32(48, 2, true); dv.setUint32(52, 2, true);
  dv.setUint32(56, p.dsdRate, true); dv.setUint32(60, 1, true); big(64, p.samples); dv.setUint32(72, BLOCK, true); dv.setUint32(76, 0, true);
  str(80, 'data'); big(84, 12 + 2 * p.blocks * BLOCK);
  return h;
}

/* ---------- полный прогон WAV → DSF (синхронно; sink.write(u8, at)) ---------- */
export function convertWav(wav, family, sink, { onProgress, shouldStop } = {}) {
  const info = wavInfo(wav), p = plan(info.frames, info.rate, family);
  const ntf = designNTF(5, 256, NTF_HINF);
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength), C = info.channels;
  const chans = Array.from({ length: C }, (_, i) => new Channel(info.rate, family, ntf, 0x1234567 + i * 7919));
  const skip = Math.floor(chans[0].delayBase) * (UP / 8);
  const packers = chans.map(() => new Packer(skip, p.totalBytes));
  sink.write(dsfHeader(p), 0);
  let written = 0; const t0 = performance.now(), CH = 4096;
  const flush = (blocksPerCh) => {
    const n = blocksPerCh[0].length;
    for (let j = 0; j < n; j++) for (let c = 0; c < 2; c++) {
      sink.write(blocksPerCh[Math.min(c, C - 1)][j], HEADER_BYTES + ((written + j) * 2 + c) * BLOCK);
    }
    written += n;
  };
  const step = (xs) => {
    const got = chans.map((ch, c) => { const per = []; for (const b of ch.push(xs[c])) per.push(...packers[c].feed(b)); return per; });
    if (got[0].length) flush(got);
  };
  let pos = 0;
  while (pos < info.frames) {
    const n = Math.min(CH, info.frames - pos), xs = chans.map(() => new Float64Array(n));
    for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) xs[c][i] = dv.getInt16(info.offset + ((pos + i) * C + c) * 2, true) / 32768;
    pos += n; step(xs);
    if (onProgress) { const el = (performance.now() - t0) / 1000, pr = Math.min(0.99, pos / info.frames); onProgress(pr, pr > 0.02 ? el * (1 - pr) / pr : 0, el); }
    if (shouldStop && shouldStop()) throw new Error('cancelled');
  }
  while (!packers[0].done()) step(chans.map(() => new Float64Array(CH)));      // хвост: нули, пока не накопится нужная длина
  const tail = packers.map(pk => pk.finish());
  if (tail[0].length) flush(tail);
  if (written !== p.blocks) throw new Error('внутренняя ошибка: блоков ' + written + ' вместо ' + p.blocks);
  const secs = (performance.now() - t0) / 1000;
  return { plan: p, seconds: secs, samplesPerSec: p.samples * 2 / secs, resets: chans.reduce((a, c) => a + c.mod.resets, 0), channels: C };
}
