// Haal alle bronnen live op en bewaar ze als momentopname in data/snapshot/.
// De server gebruikt die alleen als de live bronnen niet bereikbaar zijn (en toont dat in de app).
import { CITY } from '../server/config.js';
import { loadRdw, uuidByArea } from '../server/rdw.js';
import { loadSpdp } from '../server/spdp.js';
import { loadOsm } from '../server/osm.js';
import { loadPlaces } from '../server/places.js';
import { writeSnapshot } from '../server/cache.js';

const rdw = await loadRdw({ forceLive: true });
if (rdw.origin !== 'live') throw new Error(`RDW niet live opgehaald (${rdw.error})`);
await writeSnapshot('rdw', rdw.data);
console.log('rdw  ok', Object.fromEntries(Object.entries(rdw.data).map(([k, v]) => [k, v.length])));

const extra = [...uuidByArea().entries()].filter(([id]) => id.startsWith(`${CITY.areaManagerId}_`)).map(([, u]) => u);
const spdp = await loadSpdp(extra, { forceLive: true });
if (spdp.origin !== 'live') throw new Error(`SPDP niet live opgehaald (${spdp.error})`);
await writeSnapshot('spdp', spdp.data);
console.log('spdp ok', Object.keys(spdp.data.statics).length, 'locaties');

const only = process.argv[2]; // bijv. `npm run snapshot -- places` om alleen de bedrijven te verversen
if (!only || only === 'osm') {
  const osm = await loadOsm({ forceLive: true });
  if (osm.origin !== 'live') throw new Error(`OSM niet live opgehaald (${osm.error})`);
  await writeSnapshot('osm', osm.data);
  console.log('osm  ok', osm.data.length, 'elementen');
}

if (!only || only === 'places') {
  const places = await loadPlaces({ forceLive: true });
  if (places.origin !== 'live') throw new Error(`Bedrijven niet live opgehaald (${places.error})`);
  await writeSnapshot('places', places.data);
  console.log('places ok', places.data.length, 'bedrijven');
}
