// Bewaart de actuele bezetting (data/live.json) als regels in een CSV per maand. Daarmee kunnen we later
// voorspellen hoe vol een P+R of garage waarschijnlijk is als je aankomt (voorspellen op tabeldata).
// Draait in GitHub Actions na fetch-live.js. De CSV's staan in de aparte branch "bezetting", zodat de
// hoofdbranch er niet vol van raakt. Gebruik: node scripts/record-occupancy.js <map van de bezetting-branch>
import { readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../server/cache.js';

const outDir = process.argv[2];
if (!outDir) {
  console.error('Gebruik: node scripts/record-occupancy.js <map van de bezetting-branch>');
  process.exit(1);
}
const exists = (p) => stat(p).then(() => true, () => false);
const STALE_MS = 3 * 3600e3; // een stand die meer dan 3 uur oud is, telt niet als meting (dode koppeling)
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const HEADER = 'meting_lokaal,meting_utc,opgehaald_utc,dag,uur,minuut,locatie_id,locatie,vrij,capaciteit,bezet_pct,open,vol\n';

// Nederlandse wandklok voor een tijdstip
function local(ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { iso: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`, month: `${p.year}-${p.month}`, day: DAYS[dow], hour: +p.hour, minute: +p.minute };
}
const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

const live = JSON.parse(await readFile(path.join(DATA_DIR, 'live.json'), 'utf8'));
const spdp = JSON.parse(await readFile(path.join(DATA_DIR, 'snapshot', 'spdp.json'), 'utf8')).data;
const nameOf = (uuid) => spdp.statics?.[uuid]?.name ?? spdp.index?.find((e) => e.uuid === uuid)?.name ?? uuid;

// Laatst bewaarde meting per locatie, zodat we dezelfde stand niet twee keer opslaan
const statePath = path.join(outDir, 'laatste.json');
const last = (await exists(statePath)) ? JSON.parse(await readFile(statePath, 'utf8')) : {};

const rows = new Map(); // maand -> regels
let skipped = { dubbel: 0, oud: 0, ongeldig: 0 };
for (const [uuid, v] of Object.entries(live.facilities ?? {})) {
  const vacant = Number(v.vacant);
  const capacity = Number(v.capacity);
  if (!v.updatedAt || live.generatedAt - v.updatedAt > STALE_MS) {
    skipped.oud++;
    continue;
  }
  if (last[uuid] === v.updatedAt) {
    skipped.dubbel++;
    continue;
  }
  if (!Number.isFinite(vacant) || !Number.isFinite(capacity) || capacity <= 0 || vacant < 0 || vacant > capacity) {
    skipped.ongeldig++;
    continue;
  }
  const t = local(v.updatedAt);
  const pct = Math.round(((capacity - vacant) / capacity) * 1000) / 10;
  const line = [t.iso, new Date(v.updatedAt).toISOString(), new Date(live.generatedAt).toISOString(), t.day, t.hour, t.minute, uuid, nameOf(uuid), vacant, capacity, pct, v.open ?? '', v.full ?? ''].map(csv).join(',');
  if (!rows.has(t.month)) rows.set(t.month, []);
  rows.get(t.month).push(line);
  last[uuid] = v.updatedAt;
}

let added = 0;
for (const [month, lines] of rows) {
  const file = path.join(outDir, `bezetting-${month}.csv`);
  if (!(await exists(file))) await writeFile(file, HEADER);
  await appendFile(file, lines.join('\n') + '\n');
  added += lines.length;
}
await writeFile(statePath, JSON.stringify(last, null, 2) + '\n');
console.log(`bezetting: ${added} nieuwe metingen bewaard (overgeslagen: ${skipped.dubbel} dubbel, ${skipped.oud} verouderd, ${skipped.ongeldig} ongeldig)`);
