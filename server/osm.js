// OpenStreetMap (Overpass API): aanvullende parkeerlocaties, vooral gratis terreinen
// en particuliere garages. Communitydata: we tonen dit altijd als "volgens OpenStreetMap".
import { CITY, TTL } from './config.js';
import { fetchJson, loadWithFallback } from './cache.js';

// Hoofdserver twee keer proberen (geeft soms een tijdelijke 502), daarna een mirror.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const KEEP = ['name', 'parking', 'fee', 'access', 'capacity', 'operator', 'addr:street', 'addr:housenumber', 'maxstay', 'opening_hours', 'charge', 'covered'];

let state = null;

async function fetchAll() {
  const b = CITY.osmBBox;
  const q = `[out:json][timeout:60];(nwr["amenity"="parking"](${b.south},${b.west},${b.north},${b.east}););out center tags;`;
  let lastErr;
  for (const [i, ep] of ENDPOINTS.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000));
    try {
      const j = await fetchJson(ep, {
        method: 'POST',
        body: `data=${encodeURIComponent(q)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeoutMs: 90000,
      });
      return (j.elements ?? [])
        .map((e) => {
          const lat = e.lat ?? e.center?.lat;
          const lon = e.lon ?? e.center?.lon;
          if (lat == null || lon == null) return null;
          const tags = {};
          for (const k of KEEP) if (e.tags?.[k] != null) tags[k] = e.tags[k];
          return { id: `${e.type}/${e.id}`, lat, lon, tags };
        })
        .filter(Boolean);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Overpass niet bereikbaar');
}

export async function loadOsm(opts = {}) {
  state = await loadWithFallback('osm', TTL.osm, fetchAll, opts);
  return state;
}

export function osmStatus() {
  if (!state) return { origin: 'none' };
  return { origin: state.origin, savedAt: state.savedAt, error: state.error };
}

const PUBLIC_ACCESS = new Set([undefined, 'yes', 'public', 'permissive', 'destination']);

// Splits in gratis locaties en betaalde locaties zonder bekende prijs.
export function osmCandidates() {
  const els = state?.data ?? [];
  const free = [];
  const paidUnknown = [];
  for (const e of els) {
    const t = e.tags;
    if (!PUBLIC_ACCESS.has(t.access)) continue;
    if (['garage_boxes', 'carports'].includes(t.parking)) continue;
    if (t.fee === 'no') free.push(e);
    else if (t.fee === 'yes' && t.name) paidUnknown.push(e);
  }
  return { free, paidUnknown };
}
