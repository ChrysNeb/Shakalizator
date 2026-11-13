// Шакалография: ядро без DOM. Работает в браузере, в Web Worker и в Node (WebCrypto).
// Внутри — настоящая криптография (PBKDF2-SHA256 + AES-256-GCM); «шакальная шкура» — обратимая кодировка пакета в текст.
export const VERSION = 1;
export const PBKDF2_ITERS = 600000;
export const MAX_CHARS = 4096;
export const LEVEL_1210 = 12;
export const ERR_DECRYPT = 'Шакалы не признали. Не та фраза или не столько шакалов';

const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const subtle = globalThis.crypto.subtle;

/* ---------- base64url ---------- */
export function b64uEncode(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/'), pad = s + '='.repeat((4 - s.length % 4) % 4);
  const bin = atob(pad); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}

/* ---------- шакал-фраза (аналог BIP39): 2048 слов = 11 бит на слово, последнее слово несёт контрольную сумму ---------- */
export function wordIndex(wordlist) {
  const exact = new Map(), prefix4 = new Map();
  wordlist.forEach((w, i) => { exact.set(w, i); prefix4.set(w.slice(0, 4), i); });
  return { list: wordlist, exact, prefix4 };
}
// нормализация ввода: NFC, lowercase, ё→е, запятые/точки/переносы → пробел, нумерация «1. шакал 2) мыло» срезается
export function normalizeInput(text) {
  return text.normalize('NFC').toLowerCase().replace(/ё/g, 'е')
    .replace(/(^|\s)\d+\s*[.):\-]+(?=\s|$|[а-я])/g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[^а-яa-z0-9\s]/g, ' ').replace(/(^|\s)\d+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}
// слово → индекс: точное, по первым 4 буквам или по однозначному префиксу короче 4 букв; -1 если не из словаря
export function resolveWord(w, idx) {
  if (idx.exact.has(w)) return idx.exact.get(w);
  if (w.length >= 4 && idx.prefix4.has(w.slice(0, 4))) return idx.prefix4.get(w.slice(0, 4));
  if (w.length >= 2 && w.length < 4) { const m = []; for (let i = 0; i < idx.list.length && m.length < 2; i++) if (idx.list[i].startsWith(w)) m.push(i); if (m.length === 1) return m[0]; }
  return -1;
}
const bitsOf = (indices) => { const bits = []; for (const n of indices) for (let b = 10; b >= 0; b--) bits.push((n >> b) & 1); return bits; };
const bytesOfBits = (bits) => { const out = new Uint8Array(bits.length >> 3); for (let i = 0; i < out.length; i++) { let v = 0; for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b]; out[i] = v; } return out; };
async function checksumBits(entropy) { const h = new Uint8Array(await subtle.digest('SHA-256', entropy)); const n = entropy.length * 8 / 32, bits = []; for (let i = 0; i < n; i++) bits.push((h[i >> 3] >> (7 - (i & 7))) & 1); return bits; }
export async function phraseFromEntropy(entropy, idx) {
  const bits = [...bitsOfBytes(entropy), ...await checksumBits(entropy)];
  const words = []; for (let i = 0; i < bits.length; i += 11) { let v = 0; for (let b = 0; b < 11; b++) v = (v << 1) | bits[i + b]; words.push(idx.list[v]); }
  return words;
}
const bitsOfBytes = (bytes) => { const bits = []; for (const x of bytes) for (let b = 7; b >= 0; b--) bits.push((x >> b) & 1); return bits; };
export async function generatePhrase(count, idx) {     // count: 12 или 24 слова (128 / 256 бит энтропии)
  const entropy = new Uint8Array(count === 24 ? 32 : 16); globalThis.crypto.getRandomValues(entropy);
  return phraseFromEntropy(entropy, idx);
}
// разбор введённой фразы: слова, неизвестные слова, чексумма
export async function inspectPhrase(text, idx) {
  const typed = normalizeInput(text).split(' ').filter(Boolean);
  const resolved = typed.map(w => resolveWord(w, idx));
  const unknown = resolved.map((v, i) => v < 0 ? i : -1).filter(i => i >= 0);
  const canonical = typed.map((w, i) => resolved[i] >= 0 ? idx.list[resolved[i]] : w);
  let checksumOk = false;
  if ((typed.length === 12 || typed.length === 24) && unknown.length === 0) {
    const bits = bitsOf(resolved), entBits = typed.length * 11 * 32 / 33, entropy = bytesOfBits(bits.slice(0, entBits));
    const cs = await checksumBits(entropy);
    checksumOk = cs.every((b, i) => b === bits[entBits + i]);
  }
  return { typed, canonical, unknown, count: typed.length, standard: unknown.length === 0 && checksumOk, checksumOk, phrase: canonical.join(' ') };
}

/* ---------- крипта: PBKDF2-SHA256 (600 000) → AES-256-GCM; пакет [версия 1][salt 16][iv 12][ct+tag] ---------- */
export class ShakalError extends Error {}
async function deriveKey(phrase, level, salt, usage) {
  // уровень шакалов — вторая часть ключа: «shakal-v1|lvl=N» подмешивается в соль (в пакете уровень НЕ хранится)
  const info = enc.encode('shakal-v1|lvl=' + level);
  const fullSalt = new Uint8Array(salt.length + info.length); fullSalt.set(salt); fullSalt.set(info, salt.length);
  const base = await subtle.importKey('raw', enc.encode(phrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fullSalt, iterations: PBKDF2_ITERS }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}
export async function encryptPacket(text, phrase, level) {
  if (text.length > MAX_CHARS) throw new ShakalError('Слишком длинное сообщение');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16)), iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(phrase, level, salt, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128, additionalData: Uint8Array.of(VERSION) }, key, enc.encode(text)));
  const out = new Uint8Array(1 + 16 + 12 + ct.length); out[0] = VERSION; out.set(salt, 1); out.set(iv, 17); out.set(ct, 29); return out;
}
export async function decryptPacket(packet, phrase, level) {
  // одна и та же ошибка для неверной фразы и неверного уровня — причины не различаем
  try {
    if (packet.length < 29 + 16 || packet[0] !== VERSION) throw new Error('bad packet');
    const key = await deriveKey(phrase, level, packet.subarray(1, 17), ['decrypt']);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: packet.subarray(17, 29), tagLength: 128, additionalData: Uint8Array.of(VERSION) }, key, packet.subarray(29));
    return dec.decode(pt);
  } catch (e) { throw new ShakalError(ERR_DECRYPT); }
}

/* ---------- шакальная шкура: обратимая кодировка байтов пакета в текст ---------- */
// skins[level] — массив из 256 токенов в нижнем регистре (байт → токен); токены без пробелов, уникальны
const revCache = new Map();
function reverse(skins, level) {
  const k = String(level); if (!revCache.has(skins)) revCache.set(skins, {});
  const c = revCache.get(skins); if (!c[k]) c[k] = new Map(skins[k].map((t, i) => [t, i]));
  return c[k];
}
const rnd = (n) => { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] % n; };
const chance = (p) => rnd(1e6) < p * 1e6;
const pick = (arr) => arr[rnd(arr.length)];
// Декор: не несёт данных, декодер его выкидывает (маркеры Fwd:, -----Original Message-----, подпись, токены )))) !!!111 ...)
const DECOR_TOKEN = /^(?:\)+|>+|\.{2,}|!+1{2,}|!{3,}|1{3,}!+)$/;
const SIGNATURE = /отправлено\s+с\s+моего\s+iphone/gi;
export function encodeSkin(packet, level, skins) {
  const table = skins[String(level)]; if (!table) throw new ShakalError('Нет такого уровня');
  const is1210 = level === LEVEL_1210, mojibake = level >= 7;
  const dens = is1210 ? 0 : Math.min(1, level / 10);                 // чем выше уровень — тем больше декора
  const parts = [];
  for (const b of packet) {
    let t = table[b];
    if (is1210 || (mojibake && level <= 8 && chance(0.85))) t = t.toUpperCase();     // кракозябры в «настоящем» регистре
    else if (!is1210 && chance(0.04 + dens * 0.12)) t = t.toUpperCase();              // внезапный CAPS (декодер сравнивает в lowercase)
    parts.push(t);
    if (!is1210 && chance(0.01 + dens * 0.04)) parts.push(pick(['))))', '))))))', '!!!111', '!!!!!', '...', '))']));
  }
  const lines = []; for (let i = 0; i < parts.length; i += 10) lines.push(parts.slice(i, i + 10).join(' '));
  let text = lines.join('\n');
  const fwd = is1210 ? 3 : level >= 3 ? Math.ceil(level / 4) : 0;
  if (fwd) text = 'Fwd: '.repeat(fwd).trim() + '\n' + text;
  if (level >= 8 || is1210) text += '\n-----Original Message-----';
  if (level >= 5 && chance(Math.min(1, level / 8))) text += '\nОтправлено с моего iPhone';
  return text;
}
// «Мессенджерный мангл» переживает: NFC, любые пробелы и переносы, регистр, декор, цитирование «> »
export function decodeSkin(text, level, skins) {
  const table = skins[String(level)]; if (!table) throw new ShakalError(ERR_DECRYPT);
  const map = reverse(skins, level);
  let t = text.normalize('NFC').replace(/[​-‍﻿]/g, '').replace(SIGNATURE, ' ');
  t = t.replace(/(^|\s)fwd:/gi, ' ').replace(/-{3,}original/gi, ' ').replace(/message-{3,}/gi, ' ');
  const out = [];
  for (const raw of t.toLowerCase().split(/\s+/)) {
    const tok = raw.replace(/^>+/, '');          // «> » — цитирование почтовых клиентов
    if (!tok || DECOR_TOKEN.test(tok)) continue;
    const v = map.get(tok);
    if (v === undefined) throw new ShakalError(ERR_DECRYPT);
    out.push(v);
  }
  return Uint8Array.from(out);
}
// какому уровню принадлежит шкура: уровень с наибольшей долей узнанных токенов (если однозначно)
export function detectLevel(text, skins) {
  const toks = text.normalize('NFC').toLowerCase().replace(/(^|\s)fwd:/gi, ' ').split(/\s+/).filter(x => x && !DECOR_TOKEN.test(x));
  if (toks.length < 6) return null;
  let best = null, bestScore = 0, second = 0;
  for (const k of Object.keys(skins)) {
    const m = reverse(skins, k); let s = 0; for (const x of toks) if (m.has(x)) s++;
    const sc = s / toks.length; if (sc > bestScore) { second = bestScore; bestScore = sc; best = +k; } else if (sc > second) second = sc;
  }
  return bestScore >= 0.8 && bestScore - second >= 0.3 ? best : null;
}
export const looksLikeLink = (s) => /^[A-Za-z0-9_-]{40,}$/.test(s.trim());       // сырой пакет (из ссылки #m=…)

/* ---------- PNG 12/10: пакет в пиксели (RGB по байтам). Над данными — шапка высотой BANNER_H, под неё рисует app ---------- */
export const PNG_BANNER_H = 32;
const MAGIC = [0x53, 0x48, 0x4b, 0x4c]; // «SHKL»
export function packToImage(packet) {
  const payload = new Uint8Array(8 + packet.length); payload.set(MAGIC); new DataView(payload.buffer).setUint32(4, packet.length); payload.set(packet, 8);
  const px = Math.ceil(payload.length / 3), width = Math.max(96, Math.ceil(Math.sqrt(px))), rows = Math.ceil(px / width);
  const data = new Uint8ClampedArray(width * rows * 4);
  for (let i = 0; i < width * rows; i++) { data[i * 4 + 3] = 255; for (let c = 0; c < 3; c++) { const j = i * 3 + c; data[i * 4 + c] = j < payload.length ? payload[j] : ((i * 131 + c * 17) & 255); } }
  return { width, rows, data };           // data — RGBA для putImageData(…, 0, PNG_BANNER_H)
}
export function unpackFromImage(rgba, width, height) {
  const start = PNG_BANNER_H * width * 4, n = (height - PNG_BANNER_H) * width; if (n <= 0) throw new ShakalError('Это не шакал-картинка');
  const need = (i) => { const out = new Uint8Array(i); for (let k = 0; k < i; k++) { const p = Math.floor(k / 3), c = k % 3; out[k] = rgba[start + p * 4 + c]; } return out; };
  const head = need(8); if (!MAGIC.every((m, i) => head[i] === m)) throw new ShakalError('Это не шакал-картинка');
  const len = new DataView(head.buffer).getUint32(0 + 4); if (len > n * 3) throw new ShakalError('Картинка повреждена');
  return need(8 + len).subarray(8);
}
