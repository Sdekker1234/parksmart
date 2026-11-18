// Bestemming zoeken: snelkeuzes, PDOK Locatieserver (Kadaster, adressen/straten) en
// OpenStreetMap Nominatim (bezienswaardigheden) als laatste redmiddel.
import { CITY, LANDMARKS } from './config.js';
import { fetchJson } from './cache.js';
import { inBBox } from './geo.js';

const PDOK = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';
const FQ = `gemeentenaam:"${CITY.name}"`;

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parsePoint = (wkt) => {
  const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(wkt || '');
  return m ? { lon: +m[1], lat: +m[2] } : null;
};

const hasPhrase = (text, phrase) => new RegExp(`(^| )${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(text);

function landmarkMatches(q) {
  const nq = norm(q);
  if (nq.length < 2) return [];
  return LANDMARKS.filter(
    (l) =>
      norm(l.label).includes(nq) ||
      l.aliases.some((a) => norm(a).startsWith(nq) || hasPhrase(nq, norm(a))),
  )
    .slice(0, 4)
    .map((l) => ({ id: l.id, label: l.label, kind: 'Bezienswaardigheid', lat: l.lat, lon: l.lon }));
}

const KIND = { adres: 'Adres', weg: 'Straat', postcode: 'Postcode', woonplaats: 'Plaats', wijk: 'Wijk', buurt: 'Buurt' };

async function pdokSuggest(q, rows = 6) {
  const url = `${PDOK}/suggest?${new URLSearchParams({ q, fq: FQ, rows: String(rows), fl: 'id,weergavenaam,type,centroide_ll' })}`;
  const j = await fetchJson(url, { timeoutMs: 8000 });
  return (j.response?.docs ?? [])
    .map((d) => {
      const p = parsePoint(d.centroide_ll);
      return p ? { id: d.id, label: d.weergavenaam, kind: KIND[d.type] ?? d.type, ...p } : null;
    })
    .filter(Boolean);
}

async function nominatim(q) {
  const b = CITY.bbox;
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '3',
    countrycodes: 'nl',
    viewbox: `${b.west},${b.north},${b.east},${b.south}`,
    bounded: '1',
  })}`;
  const j = await fetchJson(url, { timeoutMs: 8000, headers: { 'Accept-Language': 'nl' } });
  return (j ?? []).map((h) => ({
    id: `osm-${h.osm_type}-${h.osm_id}`,
    label: h.name ? `${h.name}, ${CITY.name}` : h.display_name,
    kind: 'Locatie (OSM)',
    lat: +h.lat,
    lon: +h.lon,
  }));
}

export async function suggest(q) {
  const lm = landmarkMatches(q);
  let pd = [];
  try {
    pd = await pdokSuggest(q);
  } catch {
    /* PDOK onbereikbaar: alleen snelkeuzes */
  }
  const seen = new Set();
  return [...lm, ...pd].filter((r) => (seen.has(r.label) ? false : seen.add(r.label))).slice(0, 8);
}

// Eén beste treffer voor vrije tekst (gebruikt door de AI-zoekfunctie).
export async function searchOne(q) {
  const lm = landmarkMatches(q);
  if (lm.length) return lm[0];
  try {
    const pd = await pdokSuggest(q, 1);
    if (pd.length) return pd[0];
  } catch {
    /* door naar Nominatim */
  }
  try {
    const nm = await nominatim(q);
    const hit = nm.find((h) => inBBox(h, CITY.bbox));
    if (hit) return hit;
  } catch {
    /* niets gevonden */
  }
  return null;
}

const reverseCache = new Map();
export async function reverseStreet(lat, lon) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  if (reverseCache.has(key)) return reverseCache.get(key);
  let name = null;
  try {
    const url = `${PDOK}/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lon), type: 'weg', rows: '1', fl: 'straatnaam,weergavenaam' })}`;
    const j = await fetchJson(url, { timeoutMs: 6000 });
    name = j.response?.docs?.[0]?.straatnaam ?? null;
  } catch {
    name = null;
  }
  reverseCache.set(key, name);
  return name;
}

export async function reverseLabel(lat, lon) {
  try {
    const url = `${PDOK}/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lon), rows: '1', fl: 'weergavenaam' })}`;
    const j = await fetchJson(url, { timeoutMs: 6000 });
    return j.response?.docs?.[0]?.weergavenaam ?? null;
  } catch {
    return null;
  }
}
