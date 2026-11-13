// Web Worker: WAV → DSD256 (.dsf). Файл пишется потоково в OPFS (createSyncAccessHandle), в памяти — только текущий блок.
// Если OPFS недоступен, куски копятся как Blob-части (браузер сам может сбросить их на диск).
// Отмена — worker.terminate() из основного потока (цикл синхронный), недописанный файл удаляет страница.
import { convertWav, wavInfo, plan } from './dsd-core.js';

const FLUSH = 1 << 20;          // копим подряд идущие записи в 1 МБ — меньше системных вызовов

self.onmessage = async ({ data: m }) => {
  if (m.cmd !== 'start') return;
  let handle = null;
  try {
    const wav = new Uint8Array(m.wav), info = wavInfo(wav), p = plan(info.frames, info.rate, m.family);
    let write, finish, mode;
    const canOpfs = !!(self.navigator && navigator.storage && navigator.storage.getDirectory && self.FileSystemFileHandle && FileSystemFileHandle.prototype.createSyncAccessHandle);
    if (canOpfs) {
      const root = await navigator.storage.getDirectory();
      handle = await (await root.getFileHandle(m.opfsName, { create: true })).createSyncAccessHandle();
      handle.truncate(0);
      const buf = new Uint8Array(FLUSH); let fill = 0, start = 0;
      const flush = () => {
        if (!fill) return;
        const n = handle.write(buf.subarray(0, fill), { at: start });
        if (n !== fill) throw new Error('браузер не дал дописать файл в хранилище (OPFS) на отметке ' + Math.round(start / 1048576) + ' МБ — попробуйте отрезок покороче');
        start += fill; fill = 0;
      };
      write = (u, at) => { if (at !== start + fill) { flush(); start = at; } if (fill + u.length > FLUSH) flush(); buf.set(u, fill); fill += u.length; };
      finish = () => { flush(); handle.flush(); handle.close(); handle = null; return null; };
      mode = 'opfs';
    } else {
      const parts = []; let next = 0;
      write = (u, at) => { if (at !== next) throw new Error('непоследовательная запись'); parts.push(u.slice()); next += u.length; };
      finish = () => new Blob(parts, { type: 'audio/x-dsf' });
      mode = 'memory';
    }
    let last = 0;
    const r = convertWav(wav, m.family, { write }, {
      onProgress: (pr, eta, el) => { const t = performance.now(); if (t - last > 250) { last = t; self.postMessage({ type: 'progress', pr, eta, el, heap: (performance.memory && performance.memory.usedJSHeapSize) || 0 }); } },
    });
    const blob = finish();
    self.postMessage({ type: 'done', mode, blob, size: p.fileSize, seconds: r.seconds, samplesPerSec: r.samplesPerSec, resets: r.resets, channels: r.channels });
  } catch (e) {
    try { if (handle) handle.close(); } catch (_) { /* ignore */ }
    self.postMessage({ type: 'error', message: (e && e.message) || String(e) });
  }
};
