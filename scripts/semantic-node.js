// Het AI-model in Node: voor het vooraf berekenen van de vectoren (build-semantic.js) en voor de testset
// (eval-bot.js). In de browser draait hetzelfde model in public/js/semantic-worker.js.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEMANTIC, decodeIndex, createSemanticEngine } from '../public/js/semantic.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INDEX_JSON = path.join(root, 'data', 'snapshot', 'semantic.json');
export const INDEX_BIN = path.join(root, 'data', 'snapshot', 'semantic.bin');

let extractor = null;
async function getExtractor() {
  extractor ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = path.join(root, '.cache', 'transformers'); // vaste plek, zodat GitHub Actions hem kan bewaren
    return pipeline('feature-extraction', SEMANTIC.model, { dtype: SEMANTIC.dtype, revision: SEMANTIC.revision });
  })();
  return extractor;
}

export async function embedMany(texts, batch = 64) {
  const ex = await getExtractor();
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    const t = await ex(texts.slice(i, i + batch), { pooling: 'mean', normalize: true });
    out.push(...t.tolist());
  }
  return out;
}

export async function loadIndexFromDisk() {
  const meta = JSON.parse(await readFile(INDEX_JSON, 'utf8'));
  const bin = await readFile(INDEX_BIN);
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  return decodeIndex(meta, buf);
}

export function createNodeSemantic() {
  const engine = createSemanticEngine({
    loadIndex: loadIndexFromDisk,
    loadModel: async () => {
      await getExtractor();
      return async (text) => Float32Array.from((await embedMany([text]))[0]);
    },
  });
  return { ...engine, consented: () => true };
}
