// Bestemming zoeken: snelkeuzes, bedrijven (OpenStreetMap), PDOK Locatieserver (Kadaster,
// adressen/straten) en OpenStreetMap Nominatim als laatste redmiddel.
import { CITY, LANDMARKS } from './config.js';
import { fetchJson } from './cache.js';
import { inBBox } from './geo.js';
import { searchPlaces, placeInfo, branchesOf, STRONG_MATCH } from './places.js';

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

const strongPlaces = (q, limit) => searchPlaces(q, { limit }).filter((p) => p.score >= STRONG_MATCH);

export async function suggest(q) {
  const lm = landmarkMatches(q);
  const pl = strongPlaces(q, 5).map(placeInfo);
  let pd = [];
  try {
    pd = await pdokSuggest(q, 5);
  } catch {
    /* PDOK onbereikbaar: alleen snelkeuzes en bedrijven */
  }
  const seen = new Set();
  return [...lm, ...pl, ...pd].filter((r) => (seen.has(r.label) ? false : seen.add(r.label))).slice(0, 9);
}

// Eén beste treffer voor vrije tekst (gebruikt door de AI-zoekfunctie).
// Bij een bedrijf met meerdere vestigingen staan de andere in `alternatives`.
export async function searchOne(q) {
  // Volgorde: exacte snelkeuze ("station") > bedrijf op naam+straat ("Jumbo Markt") > overige snelkeuze > bedrijf.
  const nq = norm(q);
  const exact = LANDMARKS.find((l) => norm(l.label) === nq || l.aliases.some((a) => norm(a) === nq));
  if (exact) return { id: exact.id, label: exact.label, kind: 'Bezienswaardigheid', lat: exact.lat, lon: exact.lon };
  const strong = strongPlaces(q, 7);
  const best = strong[0];
  // Alternatieven: andere vestigingen met dezelfde naam, anders andere sterke treffers (bijv. andere apotheken).
  const asPlace = (p) => {
    const branches = branchesOf(p);
    const others = strong.filter((x) => x.id !== p.id).map(placeInfo);
    return { ...placeInfo(p), alternatives: (branches.length ? branches : others).slice(0, 6) };
  };
  if (best && best.score >= 70) return asPlace(best);
  const lm = landmarkMatches(q);
  if (lm.length) return lm[0];
  if (best) return asPlace(best);
  try {
    const pd = await pdokSuggest(q, 5);
    if (pd.length) {
      // Kies de treffer die echt met de zoekwoorden begint ("Paleiskwartier", niet "Paleisbrug")
      const nq = norm(q);
      return pd.find((r) => norm(r.label).startsWith(nq)) ?? pd.find((r) => norm(r.label).includes(nq)) ?? pd[0];
    }
    // "Jumbo Hinthamerstraat" zonder Jumbo daar: probeer het laatste deel (meestal de straat).
    const words = q.trim().split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const tail = await pdokSuggest(words.slice(i).join(' '), 1);
      if (tail.length) return { ...tail[0], note: `Geen "${words.slice(0, i).join(' ')}" gevonden; ik gebruik ${tail[0].label}.` };
    }
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
