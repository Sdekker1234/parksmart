// AI-zoeken in de browser: het model draait in semantic-worker.js, de vooraf berekende vectoren
// komen uit data/semantic.json en data/semantic.bin. Pas geladen als de gebruiker daar ja op zegt.
import { createSemanticEngine, decodeIndex } from './semantic.js';

const CONSENT_KEY = 'parksmart-ai-model';

export function createBrowserSemantic() {
  const supported = () => typeof Worker !== 'undefined' && typeof WebAssembly === 'object' && typeof fetch === 'function';
  let worker = null;
  let seq = 0;
  const pending = new Map();

  function startWorker() {
    // Zelfde versienummer als deze module, zodat een update nooit een oude worker gebruikt
    const v = new URL(import.meta.url).search;
    const w = new Worker(new URL(`./semantic-worker.js${v}`, import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, type } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (type === 'progress') return p.onProgress?.(e.data.info);
      pending.delete(id);
      if (type === 'ok') p.resolve(e.data);
      else p.reject(new Error(e.data.message));
    };
    w.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Het AI-model kon niet starten in deze browser.'));
      pending.clear();
      worker = null;
    };
    return w;
  }
  function call(type, payload = {}, onProgress) {
    worker ??= startWorker();
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, type, ...payload });
    });
  }

  async function loadIndex() {
    const [m, b] = await Promise.all([fetch(new URL('../data/semantic.json', import.meta.url)), fetch(new URL('../data/semantic.bin', import.meta.url))]);
    if (!m.ok || !b.ok) throw new Error('De AI-zoeklijst is niet gevonden.');
    return decodeIndex(await m.json(), await b.arrayBuffer());
  }
  async function loadModel(onProgress) {
    await call('load', {}, onProgress);
    return async (text) => Float32Array.from((await call('embed', { text })).vec);
  }

  const engine = createSemanticEngine({ loadIndex, loadModel, supported });
  engine.onStatus((s) => {
    if (s !== 'ready') return;
    try {
      localStorage.setItem(CONSENT_KEY, '1');
    } catch {
      /* geen opslag beschikbaar: dan vragen we het de volgende keer opnieuw */
    }
  });
  // Eerder al ja gezegd? Dan staat het model in de browsercache en hoeven we niet opnieuw te vragen.
  const consented = () => {
    try {
      return localStorage.getItem(CONSENT_KEY) === '1';
    } catch {
      return false;
    }
  };
  return { ...engine, consented };
}
