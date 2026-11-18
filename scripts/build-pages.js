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
await writeFile(indexPath, html);
await writeFile(path.join(dist, '404.html'), html);

const files = await readdir(dist, { recursive: true });
console.log(`dist/ klaar: ${files.length} bestanden`);
