// Bouw de statische site voor GitHub Pages in dist/.
// De rekenmotor (server/*.js) draait dan in de browser; data komt uit dist/data/*.json.
import { cp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const exists = (p) => stat(p).then(() => true, () => false);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// 1. Frontend
await cp(path.join(root, 'public'), dist, { recursive: true });
await cp(path.join(root, 'node_modules', 'leaflet', 'dist'), path.join(dist, 'vendor', 'leaflet'), { recursive: true });

// 2. Rekenmotor: alle servermodules behalve de server zelf, de AI (heeft een geheime sleutel nodig)
//    en de Node-cache; die laatste vervangen we door de browserversie.
const SERVER_ONLY = new Set(['index.js', 'ai.js', 'cache.js']);
await mkdir(path.join(dist, 'engine'), { recursive: true });
for (const f of await readdir(path.join(root, 'server'))) {
  if (!f.endsWith('.js') || f.endsWith('.test.js') || SERVER_ONLY.has(f)) continue;
  await cp(path.join(root, 'server', f), path.join(dist, 'engine', f));
}
await cp(path.join(root, 'web', 'cache.js'), path.join(dist, 'engine', 'cache.js'));

// 3. Data: momentopname + (als aanwezig) actuele bezetting
await cp(path.join(root, 'data', 'snapshot'), path.join(dist, 'data'), { recursive: true });
if (await exists(path.join(root, 'data', 'live.json'))) await cp(path.join(root, 'data', 'live.json'), path.join(dist, 'data', 'live.json'));

// 4. Statische modus aanzetten in index.html
const indexPath = path.join(dist, 'index.html');
let html = await readFile(indexPath, 'utf8');
html = html.replace('<script src="vendor/leaflet/leaflet.js"></script>', '<script>window.PARKSMART_STATIC = true;</script>\n  <script src="vendor/leaflet/leaflet.js"></script>');
if (!html.includes('PARKSMART_STATIC')) throw new Error('Kon statische modus niet aanzetten in index.html');
// 5. Versienummer achter elk script en elke stylesheet. GitHub Pages laat browsers bestanden 10 minuten
//    cachen; zonder versie kan een telefoon na een update een oude app.js combineren met een nieuwe
//    module, en dan start de app niet. Met ?v=<commit> horen alle bestanden van één update bij elkaar.
const version = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 10);
const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g;
let rewritten = 0;
for (const dir of ['js', 'engine']) {
  for (const f of await readdir(path.join(dist, dir))) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(dist, dir, f);
    const src = await readFile(p, 'utf8');
    const out = src.replace(IMPORT_RE, (m, pre, q, spec) => `${pre}${q}${spec}?v=${version}${q}`);
    if (out !== src) rewritten++;
    await writeFile(p, out);
  }
}
html = html.replace(/(src|href)="((?:js|css|vendor)\/[^"?]+\.(?:js|css))"/g, (m, attr, p) => `${attr}="${p}?v=${version}"`);
if (!html.includes(`js/app.js?v=${version}`)) throw new Error('Kon versienummer niet toevoegen aan index.html');
console.log(`versie ${version}: imports bijgewerkt in ${rewritten} modules`);

await writeFile(indexPath, html);
await writeFile(path.join(dist, '404.html'), html);

const files = await readdir(dist, { recursive: true });
console.log(`dist/ klaar: ${files.length} bestanden`);
