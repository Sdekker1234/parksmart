// Haal de actuele bezetting op van alle locaties met live data (RDW SPDP) en schrijf data/live.json.
// Voor de statische site: de browser mag SPDP niet rechtstreeks opvragen (geen CORS), dus de
// GitHub Action doet dit elk half uur. De app toont het tijdstip van de stand erbij.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadRdw } from '../server/rdw.js';
import { loadSpdp, dynamicUuids, fetchLive } from '../server/spdp.js';
import { DATA_DIR } from '../server/cache.js';

await loadRdw({ fast: true });
await loadSpdp([], { fast: true });
const uuids = dynamicUuids();
const facilities = {};
await Promise.all(
  uuids.map(async (uuid) => {
    try {
      const v = await fetchLive(uuid);
      if (v && v.vacant != null && v.updatedAt) facilities[uuid] = v;
    } catch {
      /* deze locatie overslaan */
    }
  }),
);
await mkdir(DATA_DIR, { recursive: true });
await writeFile(path.join(DATA_DIR, 'live.json'), JSON.stringify({ generatedAt: Date.now(), facilities }));
console.log(`live: ${Object.keys(facilities).length} van ${uuids.length} locaties met bezetting`);
