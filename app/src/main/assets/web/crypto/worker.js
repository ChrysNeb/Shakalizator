// Тяжёлая криптография (PBKDF2 600 000 итераций) в отдельном потоке — интерфейс не фризится.
import { encryptPacket, decryptPacket } from './core.js';
self.onmessage = async ({ data }) => {
  const { id, op, phrase, level, text, packet } = data;
  try {
    if (op === 'enc') { const p = await encryptPacket(text, phrase, level); self.postMessage({ id, ok: true, packet: p }, [p.buffer]); }
    else { const t = await decryptPacket(packet, phrase, level); self.postMessage({ id, ok: true, text: t }); }
  } catch (e) { self.postMessage({ id, ok: false, error: (e && e.message) || 'error' }); }
};
