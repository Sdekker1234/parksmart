// Draait het AI-model in een aparte thread, zodat de app niet hapert tijdens het laden en rekenen.
// Het model (Transformers.js + ONNX Runtime) komt eenmalig van Hugging Face en blijft daarna in de
// browsercache. De vraag van de gebruiker verlaat het apparaat niet: alleen het model wordt gedownload.
import { pipeline, env } from '../vendor/transformers/transformers.min.js';
import { SEMANTIC } from './semantic.js';

env.allowLocalModels = false;
let extractor = null;

self.onmessage = async (e) => {
  const { id, type, text } = e.data;
  try {
    if (type === 'load') {
      extractor ??= pipeline('feature-extraction', SEMANTIC.model, {
        dtype: SEMANTIC.dtype,
        revision: SEMANTIC.revision,
        progress_callback: (info) => {
          if (info.status === 'progress_total') self.postMessage({ id, type: 'progress', info: { progress: info.progress, loaded: info.loaded, total: info.total } });
        },
      });
      await extractor;
      self.postMessage({ id, type: 'ok' });
    } else if (type === 'embed') {
      const ex = await extractor;
      const out = await ex([text], { pooling: 'mean', normalize: true });
      self.postMessage({ id, type: 'ok', vec: Array.from(out.data) });
    } else {
      throw new Error(`Onbekende opdracht: ${type}`);
    }
  } catch (err) {
    if (type === 'load') extractor = null;
    self.postMessage({ id, type: 'error', message: String(err?.message || err) });
  }
};
