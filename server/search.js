// Combineert alle bronnen tot vergelijkbare parkeeropties voor één bestemming + tijdvak.
import { WALK, SEARCH, SOURCES, DECREE_GARAGES, DECREE_TRANSFERIA, SPDP_SKIP, decreeFor, garageWithTariff } from './config.js';
import { zoneModel, specialDays, uuidByArea, capacityByArea } from './rdw.js';
import { staticFor, extraFacilities, liveFor, dynamicUuidsByName, validTariffs } from './spdp.js';
import { osmCandidates } from './osm.js';
import { haversine, nearestOnPolygons, pointInAny } from './geo.js';
import { priceZone, priceGarage, priceTransferium, priceSpdp, entryWarning, unknownPrice, ymdOf, eur, fmtMin, round2 } from './pricing.js';
import { reverseStreet } from './geocode.js';

const MAX_OSM_FREE = 12;

// Prijs op basis van een ouder besluitjaar: als schatting markeren (nooit als geverifieerd tonen).
const markEstimate = (price, decree) => (decree.estimated && price.known ? { ...price, estimated: true } : price);

function walkInfo(dest, p, insideZone = false) {
  const straight = haversine(dest, p);
  if (insideZone) return { straightM: 0, meters: 100, minutes: 2, estimate: true, insideZone: true };
  const meters = Math.round(straight * WALK.detourFactor);
  return { straightM: Math.round(straight), meters, minutes: Math.max(1, Math.round(meters / WALK.speedMPerMin)), estimate: true, insideZone: false };
}

const DAY_ORDER = ['MAANDAG', 'DINSDAG', 'WOENSDAG', 'DONDERDAG', 'VRIJDAG', 'ZATERDAG', 'ZONDAG'];
const DAY_SHORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

// "ma–za 09:00–24:00 · zo 12:00–24:00"
function summarizePaidTimes(timeframes) {
  const perDay = DAY_ORDER.map((day) =>
    timeframes
      .filter((t) => t.day === day && t.fareCode && t.fareCode !== 'TAR_0')
      .sort((a, b) => a.start - b.start)
      .map((t) => `${fmtMin(t.start)}–${fmtMin(t.end)}${t.maxMin ? ` (max ${t.maxMin} min)` : ''}`)
      .join(', ') || 'gratis',
  );
  const groups = [];
  perDay.forEach((txt, i) => {
    const last = groups[groups.length - 1];
    if (last && last.txt === txt && last.to === i - 1) last.to = i;
    else groups.push({ from: i, to: i, txt });
  });
  return groups
    .map((g) => `${g.from === g.to ? DAY_SHORT[g.from] : `${DAY_SHORT[g.from]}–${DAY_SHORT[g.to]}`} ${g.txt}`)
    .join(' · ');
}

function parseMaxStay(v) {
  const m = /(\d+(?:[.,]\d+)?)\s*(h|hr|hour|hours|uur|min|minutes|minuten)\b/i.exec(v || '');
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return /^m/i.test(m[2]) ? n : n * 60;
}

const normName = (s) => String(s || '').toLowerCase().replace(/parkeergarage|garage|q-park|\(.*?\)|'s[- ]hertogenbosch|[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export async function search({ dest, arrival, durationMin }) {
  const ymd = ymdOf(arrival);
  const model = zoneModel(ymd);
  const ctx = { specialDays: specialDays(), fareParts: (d) => (zoneModel(d) ?? model).fareParts };
  const uuids = uuidByArea();
  const caps = capacityByArea();
  const tSec = arrival.getTime() / 1000;
  const options = [];

  // 1. Straatparkeren in RDW-betaalzones
  for (const z of model?.zones ?? []) {
    const near = nearestOnPolygons(dest, z.polygons);
    if (!near || near.distM > SEARCH.walkRadiusM) continue;
    const notes = [];
    if (z.freeFirstMin) notes.push(`Eerste ${z.freeFirstMin / 60} uur gratis (wel parkeeractie starten).`);
    if (near.inside) notes.push('Je bestemming ligt in deze zone. Zoek een plek zo dichtbij mogelijk.');
    else notes.push('Punt op de kaart = rand van de zone het dichtst bij je bestemming.');
    options.push({
      id: `zone:${z.id}`,
      type: 'street',
      kind: 'Straatparkeren',
      name: `Zone ${z.name}`,
      zoneId: z.id,
      lat: near.lat,
      lon: near.lon,
      walk: walkInfo(dest, near, near.inside),
      price: priceZone(z, arrival, durationMin, ctx),
      source: SOURCES.rdwNpr,
      details: {
        tariff: `${z.fareDesc} · ${eur(z.perHour)}/u`,
        paidTimes: summarizePaidTimes(z.timeframes),
        regulation: z.regulationDesc,
      },
      notes,
      warnings: [],
    });
  }

  // 2. Gemeentelijke garages (tarieven uit het gemeentebesluit van dat jaar, locatie uit RDW SPDP)
  const decree = decreeFor(ymd);
  const decreeSource = decree.estimated
    ? { key: 'decree-estimate', label: `${decree.title} (tarief ${decree.forYear} nog niet verwerkt)`, url: decree.url, trust: 'estimate' }
    : { key: 'decree', label: decree.title, url: decree.url, trust: 'official' };
  const decreeNotes = decree.estimated
    ? [`Schatting: het gemeentelijke tarief voor ${decree.forYear} is nog niet verwerkt. Ik reken met het tarief van ${decree.year}; het echte tarief is waarschijnlijk iets hoger.`]
    : [];
  for (const g of DECREE_GARAGES) {
    const gt = garageWithTariff(g, decree);
    const s = staticFor(uuids.get(g.areaId));
    const loc = s?.lat ? { lat: s.lat, lon: s.lon } : g.fallback;
    if (haversine(dest, loc) > SEARCH.walkRadiusM) continue;
    const warn = entryWarning(s?.openingTimes, arrival);
    options.push({
      id: `garage:${g.areaId}`,
      type: 'garage',
      kind: 'Parkeergarage',
      name: g.name,
      address: s?.address ?? g.fallback.address,
      lat: loc.lat,
      lon: loc.lon,
      capacity: caps.get(g.areaId) ?? s?.capacity ?? g.fallback.capacity,
      walk: walkInfo(dest, loc),
      price: markEstimate(priceGarage(gt, arrival, durationMin, ctx), decree),
      source: decreeSource,
      details: {
        tariff: `${eur(gt.dayRate)}/u overdag · ${eur(gt.eveningRate)}/u avond/nacht (max ${eur(gt.eveningMax)}) · max ${eur(gt.dayMax)} per dag`,
        paidTimes: 'Avondtarief 18:00–07:00 (do vanaf 21:00), zondag- en feestdagochtend 07:00–12:00',
      },
      notes: [...(g.sundayFree ? ['Zondag 07:00–14:00 gratis.'] : []), ...decreeNotes],
      warnings: warn ? [warn] : [],
      liveUuids: dynamicUuidsByName(g.match),
    });
  }

  // 3. Transferia met pendelbus/leenfiets
  for (const t of DECREE_TRANSFERIA) {
    const s = staticFor(uuids.get(t.areaId));
    const loc = s?.lat ? { lat: s.lat, lon: s.lon } : t.fallback;
    if (haversine(dest, loc) > SEARCH.shuttleRadiusM) continue;
    const warn = entryWarning(s?.openingTimes, arrival);
    options.push({
      id: `pr:${t.areaId}`,
      type: 'pr',
      kind: 'Transferium (P+R)',
      shuttle: true,
      name: t.name,
      address: s?.address ?? t.fallback.address,
      lat: loc.lat,
      lon: loc.lon,
      capacity: caps.get(t.areaId) ?? s?.capacity ?? t.fallback.capacity,
      walk: walkInfo(dest, loc),
      price: markEstimate(priceTransferium({ perDay: decree.transferiumPerDay }, durationMin), decree),
      source: decreeSource,
      details: { tariff: `${eur(decree.transferiumPerDay)} per dag, inclusief bus of leenfiets (max. 4 personen)` },
      notes: [
        'Neem de bus of een leenfiets naar het centrum (inbegrepen volgens het besluit).',
        `Let op: RDW-data noemt €3,00 per dag; ik toon het tarief uit het gemeentebesluit ${decree.year}.`,
        ...(t.note ? [t.note] : []),
        ...decreeNotes,
      ],
      warnings: warn ? [warn] : [],
    });
  }

  // 4. Overige locaties uit RDW SPDP (P+R station, ziekenhuis, gratis P+R)
  const skip = new Set([...DECREE_GARAGES, ...DECREE_TRANSFERIA].map((x) => uuids.get(x.areaId)).filter(Boolean));
  for (const f of extraFacilities(skip, SPDP_SKIP)) {
    const loc = { lat: f.lat, lon: f.lon };
    if (haversine(dest, loc) > SEARCH.walkRadiusM) continue;
    const isCarpool = /carpool/i.test(f.name);
    const hasTariff = validTariffs(f, tSec).length > 0;
    if (isCarpool && !hasTariff) continue;
    const price = hasTariff ? priceSpdp(f, arrival, durationMin) : unknownPrice('Geen tarief beschikbaar in RDW-data.');
    const isFree = price.known && price.feasible && price.total === 0;
    const isPR = /^p\+r/i.test(f.name);
    options.push({
      id: `spdp:${f.key}`,
      type: isFree ? 'free' : isPR ? 'pr' : 'garage',
      kind: isCarpool ? 'Carpoolplaats' : isPR ? 'P+R' : /terrein/i.test(f.name) ? 'Parkeerterrein' : 'Parkeergarage',
      name: f.name,
      address: f.address,
      lat: f.lat,
      lon: f.lon,
      capacity: f.capacity,
      walk: walkInfo(dest, loc),
      price,
      source: SOURCES.spdp,
      details: { tariff: price.tariffNames?.join(' · ') || null },
      notes: isPR && !isFree ? ['P+R bij het station; tarief volgens de exploitant in RDW-data.'] : [],
      warnings: [entryWarning(f.openingTimes, arrival)].filter(Boolean),
      liveUuids: f.dynamicUuids,
    });
  }

  // 5. OpenStreetMap: gratis locaties en betaalde locaties zonder open tariefdata
  const known = options.filter((o) => o.type !== 'street');
  const paidZones = (model?.zones ?? []).filter((z) => z.perHour > 0);
  const { free, paidUnknown } = osmCandidates();
  const freeOpts = [];
  for (const e of free) {
    const d = haversine(dest, e);
    if (d > SEARCH.walkRadiusM) continue;
    if (paidZones.some((z) => pointInAny(e, z.polygons))) continue; // RDW zegt betaald: OSM-"gratis" negeren
    if (known.some((k) => haversine(k, e) < 60)) continue;
    const maxStay = parseMaxStay(e.tags.maxstay);
    const t = e.tags;
    const kind = ['street_side', 'lane', 'on_kerb', 'half_on_kerb'].includes(t.parking)
      ? 'Langs de weg'
      : ['multi-storey', 'underground'].includes(t.parking)
        ? 'Parkeergarage'
        : 'Parkeerterrein';
    freeOpts.push({
      d,
      opt: {
        id: `osm:${e.id}`,
        type: 'free',
        kind,
        name: t.name || null,
        osmId: e.id,
        lat: e.lat,
        lon: e.lon,
        capacity: t.capacity ? Number(t.capacity) || null : null,
        walk: walkInfo(dest, e),
        price:
          maxStay && maxStay < durationMin
            ? { known: true, feasible: false, total: null, reason: `Maximale parkeerduur ${maxStay / 60} uur (OSM).`, breakdown: [] }
            : { known: true, feasible: true, total: 0, breakdown: [{ label: 'Gratis volgens OpenStreetMap', minutes: durationMin, cost: 0 }] },
        source: SOURCES.osm,
        details: { tariff: 'Gratis (fee=no in OpenStreetMap)' },
        notes: maxStay ? [`Maximale parkeerduur: ${t.maxstay}.`] : [],
        warnings: ['Communitydata uit OpenStreetMap. Controleer de borden ter plaatse.'],
      },
    });
  }
  freeOpts.sort((a, b) => a.d - b.d);
  const topFree = freeOpts.slice(0, MAX_OSM_FREE).map((x) => x.opt);
  await Promise.all(
    topFree.map(async (o) => {
      if (o.name) return;
      const street = await reverseStreet(o.lat, o.lon);
      o.name = street ? `Gratis parkeren ${o.kind === 'Langs de weg' ? 'aan de' : 'bij'} ${street}` : `Gratis ${o.kind.toLowerCase()}`;
    }),
  );
  // Zelfde naam binnen 250 m = waarschijnlijk dezelfde plek: houd de dichtstbijzijnde (lijst is al gesorteerd).
  const kept = [];
  for (const o of topFree) {
    if (kept.some((k) => k.name === o.name && haversine(k, o) < 250)) continue;
    kept.push(o);
  }
  options.push(...kept);

  for (const e of paidUnknown) {
    if (haversine(dest, e) > SEARCH.walkRadiusM) continue;
    const n = normName(e.tags.name);
    if (known.some((k) => haversine(k, e) < 150 || (n && normName(k.name).includes(n)) || (n && n.includes(normName(k.name))))) continue;
    options.push({
      id: `osm:${e.id}`,
      type: 'garage',
      kind: ['multi-storey', 'underground'].includes(e.tags.parking) ? 'Parkeergarage' : 'Parkeerterrein',
      name: e.tags.name,
      operator: e.tags.operator ?? null,
      osmId: e.id,
      lat: e.lat,
      lon: e.lon,
      capacity: e.tags.capacity ? Number(e.tags.capacity) || null : null,
      walk: walkInfo(dest, e),
      price: unknownPrice('Geen tarief in open data. Check de site van de exploitant.'),
      source: SOURCES.osm,
      details: { tariff: e.tags.operator ? `Exploitant: ${e.tags.operator}` : null },
      notes: [],
      warnings: [],
    });
  }

  // 6. Live bezetting (alleen als recent bijgewerkt)
  await Promise.all(
    options.map(async (o) => {
      if (o.liveUuids?.length) o.live = await liveFor(o.liveUuids);
      delete o.liveUuids;
    }),
  );

  for (const o of options) {
    if (o.price.known && o.price.feasible && durationMin > 0) o.price.perHour = round2(o.price.total / (durationMin / 60));
  }
  return options;
}

// Zones voor de kaart (polygonen + tariefinfo).
export function zonesForMap(ymd) {
  const model = zoneModel(ymd);
  return (model?.zones ?? []).map((z) => ({
    id: z.id,
    name: `Zone ${z.name}`,
    perHour: z.perHour,
    fareDesc: z.fareDesc,
    freeFirstMin: z.freeFirstMin,
    paidTimes: summarizePaidTimes(z.timeframes),
    polygons: z.polygons.map((poly) => poly.map((ring) => ring.map(([x, y]) => [Math.round(y * 1e6) / 1e6, Math.round(x * 1e6) / 1e6]))),
  }));
}
