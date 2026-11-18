// RDW Shared Parking Data Platform (SPDP): statische gegevens (locatie, capaciteit,
// openingstijden, tarieven) en dynamische gegevens (vrije plekken) per parkeerlocatie.
// Bron: https://npropendata.rdw.nl/parkingdata/v2/
import { TTL, SPDP_NAME_FILTER, LIVE_MAX_AGE_MIN } from './config.js';
import { fetchJson, loadWithFallback } from './cache.js';

const BASE = 'https://npropendata.rdw.nl/parkingdata/v2';

let state = null;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]).catch((e) => ({ error: e.message }));
      }
    }),
  );
  return out;
}

function trimStatic(uuid, json) {
  const p = json?.parkingFacilityInformation;
  if (!p) return null;
  const aps = (p.accessPoints ?? []).filter((a) => a?.accessPointLocation?.length);
  const ap = aps.find((a) => a.isVehicleEntrance) ?? aps[0];
  const loc = ap?.accessPointLocation?.[0];
  const addr = ap?.accessPointAddress;
  const specs = [...(p.specifications ?? [])].sort((a, b) => (b.validityStartOfPeriod ?? 0) - (a.validityStartOfPeriod ?? 0));
  return {
    uuid,
    name: p.name || p.description,
    description: p.description,
    validUntil: p.validityEndOfPeriod ?? null,
    lat: loc?.latitude ?? null,
    lon: loc?.longitude ?? null,
    address: addr ? [addr.streetName, addr.houseNumber && addr.houseNumber !== '0' ? addr.houseNumber : ''].filter(Boolean).join(' ') : null,
    capacity: specs[0]?.capacity ?? null,
    openingTimes: p.openingTimes ?? [],
    tariffs: p.tariffs ?? [],
  };
}

async function fetchAll(extraUuids) {
  const index = await fetchJson(`${BASE}/`, { timeoutMs: 60000 });
  const list = (index.ParkingFacilities ?? []).filter((f) => SPDP_NAME_FILTER.test(f.name));
  const uuids = [...new Set([...list.map((f) => f.identifier), ...extraUuids])];
  const statics = {};
  await mapLimit(uuids, 6, async (uuid) => {
    const json = await fetchJson(`${BASE}/static/${uuid}`, { timeoutMs: 30000 });
    const t = trimStatic(uuid, json);
    if (t) statics[uuid] = t;
  });
  return {
    index: list.map((f) => ({ uuid: f.identifier, name: f.name, dynamic: Boolean(f.dynamicDataUrl) })),
    statics,
  };
}

export async function loadSpdp(extraUuids = [], opts = {}) {
  state = await loadWithFallback('spdp', TTL.spdpStatic, () => fetchAll(extraUuids), opts);
  return state;
}

export function spdpStatus() {
  if (!state) return { origin: 'none' };
  return { origin: state.origin, savedAt: state.savedAt, error: state.error };
}

export function staticFor(uuid) {
  return state?.data?.statics?.[uuid] ?? null;
}

const baseName = (n) =>
  String(n || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/'s[- ]hertogenbosch/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const nowSec = () => Date.now() / 1000;
const isValid = (start, end, t) => (!start || start <= t) && (!end || end > t);

export function validTariffs(fac, tSec = nowSec()) {
  return (fac?.tariffs ?? []).filter((t) => isValid(t.startOfPeriod, t.endOfPeriod, tSec));
}

// Overige SPDP-locaties (P+R, ziekenhuis, carpool), samengevoegd per naam.
export function extraFacilities(skipUuids, skipNameRe) {
  const data = state?.data;
  if (!data) return [];
  const groups = new Map();
  for (const entry of data.index) {
    if (skipUuids.has(entry.uuid) || skipNameRe.test(entry.name)) continue;
    const s = data.statics[entry.uuid];
    if (!s) continue;
    const key = baseName(entry.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...s, indexName: entry.name, dynamic: entry.dynamic });
  }
  const out = [];
  for (const [key, recs] of groups) {
    // Locatie: liefst een record dat nog geldig is.
    const byValidity = [...recs].sort((a, b) => (a.validUntil ? 1 : 0) - (b.validUntil ? 1 : 0));
    const locRec = byValidity.find((r) => r.lat && r.lon);
    if (!locRec) continue;
    const tarRec = byValidity.find((r) => validTariffs(r).length) ?? null;
    out.push({
      key,
      name: (locRec.name || locRec.indexName).replace(/\s*\('s-Hertogenbosch\)|\s*\(Rosmalen\)/, ''),
      lat: locRec.lat,
      lon: locRec.lon,
      address: locRec.address,
      capacity: recs.map((r) => r.capacity).find(Boolean) ?? null,
      openingTimes: locRec.openingTimes,
      tariffs: tarRec ? tarRec.tariffs : [],
      tariffUuid: tarRec?.uuid ?? null,
      dynamicUuids: recs.filter((r) => r.dynamic).map((r) => r.uuid),
      uuids: recs.map((r) => r.uuid),
    });
  }
  return out;
}

export function dynamicUuidsByName(re) {
  return (state?.data?.index ?? []).filter((e) => e.dynamic && re.test(e.name)).map((e) => e.uuid);
}

// ---- Live bezetting ----
const liveCache = new Map(); // uuid -> { at, value }

async function fetchLive(uuid) {
  const json = await fetchJson(`${BASE}/dynamic/${uuid}`, { timeoutMs: 15000 });
  const st = json?.parkingFacilityDynamicInformation?.facilityActualStatus;
  if (!st) return null;
  return {
    vacant: st.vacantSpaces ?? null,
    capacity: st.parkingCapacity ?? null,
    open: st.open ?? null,
    full: st.full ?? null,
    updatedAt: st.lastUpdated ? st.lastUpdated * 1000 : null,
  };
}

export async function liveFor(uuids) {
  for (const uuid of uuids ?? []) {
    const c = liveCache.get(uuid);
    let value = c && Date.now() - c.at < TTL.spdpDynamic ? c.value : undefined;
    if (value === undefined) {
      value = await fetchLive(uuid).catch(() => null);
      liveCache.set(uuid, { at: Date.now(), value });
    }
    if (value?.updatedAt && Date.now() - value.updatedAt < LIVE_MAX_AGE_MIN * 60e3 && value.vacant != null) {
      return { ...value, uuid };
    }
  }
  return null;
}
