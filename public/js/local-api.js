// Statische versie (GitHub Pages): dezelfde API als de server, maar alles draait in de browser.
// Alleen in gebruik als window.PARKSMART_STATIC is gezet; de map ../engine/ bestaat alleen in de build.
import { CITY, LANDMARKS, SEARCH } from '../engine/config.js';
import { loadRdw, rdwStatus } from '../engine/rdw.js';
import { loadSpdp, spdpStatus, setLiveProvider } from '../engine/spdp.js';
import { loadOsm, osmStatus } from '../engine/osm.js';
import { loadPlaces, placesStatus } from '../engine/places.js';
import { search, zonesForMap } from '../engine/search.js';
import { suggest, searchOne, reverseLabel } from '../engine/geocode.js';
import { parseArrival } from '../engine/pricing.js';
import { parseRules, adviceRules } from '../engine/rules.js';
import { inBBox } from '../engine/geo.js';

const AI_OFF = {
  enabled: false,
  model: null,
  reason: 'Online testversie zonder server: Claude heeft een server nodig om je API-sleutel geheim te houden',
};

let ready = null;
let liveInfo = null;
function ensure() {
  ready ??= (async () => {
    await loadRdw();
    await Promise.all([loadSpdp([]), loadOsm(), loadPlaces(), loadLive()]);
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

// Bezetting die de GitHub Action elk half uur ophaalt. Ouder dan 90 minuten tonen we niet.
async function loadLive() {
  try {
    const res = await fetch(new URL('../data/live.json', import.meta.url), { cache: 'no-cache' });
    const j = res.ok ? await res.json() : { facilities: {} };
    liveInfo = { generatedAt: j.generatedAt ?? null, count: Object.keys(j.facilities ?? {}).length };
    const map = new Map(Object.entries(j.facilities ?? {}));
    setLiveProvider(async (uuid) => map.get(uuid) ?? null, { maxAgeMin: 90 });
  } catch {
    setLiveProvider(async () => null);
  }
}

function nowNL() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute));
}

const fail = (status, body) => Object.assign(new Error(body.message || body.error), { status, body });

export const localApi = {
  async status() {
    await ensure();
    return {
      city: { name: CITY.name, shortName: CITY.shortName, center: CITY.center, bbox: CITY.bbox },
      landmarks: LANDMARKS.map(({ id, label, lat, lon }) => ({ id, label, lat, lon })),
      now: nowNL().toISOString().slice(0, 16),
      ai: AI_OFF,
      static: true,
      live: liveInfo,
      data: { rdw: rdwStatus(), spdp: spdpStatus(), osm: osmStatus(), places: placesStatus() },
    };
  },

  async zones(date) {
    await ensure();
    return { zones: zonesForMap(String(date).replace(/-/g, '')) };
  },

  async search(p) {
    await ensure();
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    const durationMin = Math.round(Number(p.duration));
    const arrival = parseArrival(p.arrival) ?? nowNL();
    if (!inBBox({ lat, lon }, CITY.bbox)) throw fail(422, { error: 'outside', message: `ParkSmart werkt voorlopig alleen in ${CITY.shortName}.` });
    if (!Number.isFinite(durationMin) || durationMin < 15 || durationMin > 7 * 1440) throw fail(400, { error: 'Duur moet tussen 15 min en 7 dagen liggen' });
    const options = await search({ dest: { lat, lon }, arrival, durationMin });
    return { destination: { lat, lon }, arrival: arrival.toISOString().slice(0, 16), durationMin, radius: SEARCH, generatedAt: new Date().toISOString(), options };
  },

  async suggest(q) {
    await ensure();
    return { results: await suggest(String(q).slice(0, 120)) };
  },

  async geocode(q) {
    await ensure();
    return { result: await searchOne(String(q).slice(0, 120)) };
  },

  async reverse(lat, lon) {
    return { label: await reverseLabel(Number(lat), Number(lon)), inCity: inBBox({ lat: Number(lat), lon: Number(lon) }, CITY.bbox) };
  },

  async route(from, to) {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw fail(502, { error: 'Looproute niet beschikbaar' });
    const r = (await res.json()).routes?.[0];
    if (!r) throw fail(502, { error: 'Geen route' });
    return { distance: Math.round(r.distance), minutes: Math.max(1, Math.round(r.distance / 80)), coordinates: r.geometry.coordinates.map(([x, y]) => [y, x]) };
  },

  async aiParse(text) {
    await ensure();
    const parsed = { ...parseRules(String(text).slice(0, 500), nowNL()), source: 'rules' };
    const place = parsed.destination ? await searchOne(parsed.destination) : null;
    return { ...parsed, place, placeInCity: place ? inBBox(place, CITY.bbox) : null };
  },

  async advice(payload) {
    return { ...adviceRules({ ...payload, options: payload.options ?? [] }), source: 'rules' };
  },
};
