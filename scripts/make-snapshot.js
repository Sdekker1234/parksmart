// Haal de bronnen live op en bewaar ze als momentopname in data/snapshot/.
// De server gebruikt die als de live bronnen niet bereikbaar zijn; de statische site (GitHub Pages)
// gebruikt ze als databron.
//
//   npm run snapshot                    alles verversen (stopt bij een fout)
//   npm run snapshot -- places          alleen één bron (rdw, spdp, osm of places)
//   node scripts/make-snapshot.js --keep-on-error
//                                       voor de GitHub Action: bij een fout de oude data houden;
//                                       zware OpenStreetMap-queries alleen als de data oud is
import { CITY } from '../server/config.js';
import { loadRdw, uuidByArea } from '../server/rdw.js';
import { loadSpdp } from '../server/spdp.js';
import { loadOsm } from '../server/osm.js';
import { loadPlaces } from '../server/places.js';
import { writeSnapshot, readSnapshot } from '../server/cache.js';

const args = process.argv.slice(2);
const keepOnError = args.includes('--keep-on-error');
const only = args.find((a) => !a.startsWith('--'));
const DAY = 24 * 3600e3;
// Minimale leeftijd voor een nieuwe Overpass-query in de Action (Overpass is traag en gedeeld).
const MIN_AGE = { osm: DAY - 3600e3, places: 7 * DAY - 3600e3 };

let failures = 0;
async function refresh(name, loader, count) {
  if (only && only !== name) return;
  if (keepOnError && MIN_AGE[name]) {
    const old = await readSnapshot(name);
    if (old && Date.now() - old.savedAt < MIN_AGE[name]) {
      console.log(`${name.padEnd(6)} overgeslagen (nog vers, ${new Date(old.savedAt).toISOString()})`);
      return;
    }
  }
  try {
    const res = await loader();
    if (res.origin !== 'live') throw new Error(res.error || `niet live (${res.origin})`);
    await writeSnapshot(name, res.data);
    console.log(`${name.padEnd(6)} ok (${count(res.data)})`);
  } catch (err) {
    failures++;
    console.warn(`${name.padEnd(6)} MISLUKT: ${err.message}${keepOnError ? ' (oude data blijft staan)' : ''}`);
    if (!keepOnError) process.exit(1);
  }
}

await refresh('rdw', () => loadRdw({ forceLive: true }), (d) => `${Object.values(d).reduce((s, v) => s + v.length, 0)} rijen`);
// SPDP heeft de UUID's van de gemeentelijke garages uit RDW nodig (anders uit de bestaande momentopname).
if (!only || only === 'spdp') {
  if (only === 'spdp') await loadRdw({ fast: true });
  const extra = [...uuidByArea().entries()].filter(([id]) => id.startsWith(`${CITY.areaManagerId}_`)).map(([, u]) => u);
  await refresh('spdp', () => loadSpdp(extra, { forceLive: true }), (d) => `${Object.keys(d.statics).length} locaties`);
}
await refresh('osm', () => loadOsm({ forceLive: true }), (d) => `${d.length} parkeerplekken`);
await refresh('places', () => loadPlaces({ forceLive: true }), (d) => `${d.length} bedrijven`);

if (failures) console.warn(`${failures} bron(nen) niet ververst.`);
