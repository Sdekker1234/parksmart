// Zet in GitHub Actions de nieuwste momentopname terug uit de cache van de vorige run.
// Zonder deze stap bouwde elke run van het halfuur de site opnieuw met de (oude) data uit de repo,
// waardoor 's nachts ververste tarieven na een half uur weer verdwenen.
// Per bestand wint de nieuwste versie: die uit de repo of die uit de cache.
// Gebruik: node scripts/merge-snapshot.js <map met de momentopname uit de cache>
import { readFile, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.join(root, 'data', 'snapshot');
const cacheDir = process.argv[2];
const exists = (p) => stat(p).then(() => true, () => false);

if (!cacheDir || !(await exists(cacheDir))) {
  console.log('Geen eerdere momentopname in de cache; de data uit de repo blijft staan.');
  process.exit(0);
}

async function stamp(file, field) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))[field] ?? 0;
  } catch {
    return 0;
  }
}
const iso = (t) => (t ? new Date(typeof t === 'string' ? t : t).toISOString() : '-');

// [bestanden, het json-bestand met de tijd, het veld met de tijd]
const groups = [
  [['rdw.json'], 'rdw.json', 'savedAt'],
  [['spdp.json'], 'spdp.json', 'savedAt'],
  [['osm.json'], 'osm.json', 'savedAt'],
  [['places.json'], 'places.json', 'savedAt'],
  [['semantic.json', 'semantic.bin'], 'semantic.json', 'createdAt'],
  [['refresh-status.json'], 'refresh-status.json', 'checkedAt'],
];
for (const [files, main, field] of groups) {
  const fromCache = path.join(cacheDir, main);
  if (!(await exists(fromCache))) continue;
  const tCache = await stamp(fromCache, field);
  const tRepo = await stamp(path.join(repoDir, main), field);
  const newer = new Date(tCache).getTime() > new Date(tRepo).getTime();
  if (newer) for (const f of files) if (await exists(path.join(cacheDir, f))) await copyFile(path.join(cacheDir, f), path.join(repoDir, f));
  console.log(`${main.padEnd(20)} ${newer ? 'uit de cache' : 'uit de repo '} (cache ${iso(tCache)}, repo ${iso(tRepo)})`);
}
