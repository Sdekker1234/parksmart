// Berekent vooraf de betekenisvectoren van onze eigen bronnen voor het AI-zoeken:
// soorten zaken (met gewone woorden), alle bedrijven uit OpenStreetMap en de bekende plekken.
// Schrijft data/snapshot/semantic.json (wat er in de index staat) en semantic.bin (de vectoren).
// Doet niets als de bronnen niet veranderd zijn. Gebruik: node scripts/build-semantic.js [--force] [--keep-on-error]
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANDMARKS } from '../server/config.js';
import { CAT_PHRASES } from '../server/semantic-cats.js';
import { SEMANTIC, encodeIndex } from '../public/js/semantic.js';
import { embedMany, INDEX_JSON, INDEX_BIN } from './semantic-node.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const keepOnError = process.argv.includes('--keep-on-error');
const exists = (p) => stat(p).then(() => true, () => false);

const raw = JSON.parse(await readFile(path.join(root, 'data', 'snapshot', 'places.json'), 'utf8'));
const places = (raw.data ?? raw).filter((p) => p.name && p.cat);

const items = [];
const cats = [...new Set(places.map((p) => p.cat))].sort((a, b) => a.localeCompare(b, 'nl'));
for (const cat of cats) {
  for (const text of new Set([cat, ...(CAT_PHRASES[cat] ?? [])])) items.push({ k: 'c', cat, text });
}
for (const p of places) {
  items.push({ k: 'p', id: p.id, cat: p.cat, name: p.name, street: p.street ?? null, nr: p.nr ?? null, lat: p.lat, lon: p.lon, text: `${p.name}, ${p.cat}` });
}
for (const lm of LANDMARKS) {
  for (const text of new Set([lm.label, ...(lm.aliases ?? [])])) items.push({ k: 'l', id: lm.id, label: lm.label, lat: lm.lat, lon: lm.lon, text });
}

const inputHash = createHash('sha256')
  .update(JSON.stringify([SEMANTIC.model, SEMANTIC.revision, SEMANTIC.dtype, items.map((i) => [i.k, i.id ?? i.cat, i.text])]))
  .digest('hex')
  .slice(0, 16);

if (!force && (await exists(INDEX_JSON)) && (await exists(INDEX_BIN))) {
  const old = JSON.parse(await readFile(INDEX_JSON, 'utf8'));
  if (old.inputHash === inputHash) {
    console.log(`AI-index is actueel (${old.items.length} items, ${inputHash}); niets te doen.`);
    process.exit(0);
  }
}

try {
  const t0 = Date.now();
  const vectors = await embedMany(items.map((i) => i.text));
  const dims = vectors[0].length;
  const buf = encodeIndex(vectors, dims);
  const meta = {
    model: SEMANTIC.model,
    revision: SEMANTIC.revision,
    dtype: SEMANTIC.dtype,
    dims,
    inputHash,
    createdAt: new Date().toISOString(),
    counts: { categories: cats.length, categoryPhrases: items.filter((i) => i.k === 'c').length, places: places.length, landmarks: LANDMARKS.length },
    items,
  };
  await writeFile(INDEX_BIN, Buffer.from(buf));
  await writeFile(INDEX_JSON, JSON.stringify(meta));
  console.log(`AI-index gemaakt: ${items.length} items × ${dims} dimensies in ${Math.round((Date.now() - t0) / 1000)} s (${Math.round(buf.byteLength / 1024)} kB).`);
} catch (err) {
  console.error(`AI-index maken mislukt: ${err.message}`);
  if (!keepOnError || !(await exists(INDEX_JSON))) process.exit(1);
  console.error('De vorige AI-index blijft in gebruik.');
}
