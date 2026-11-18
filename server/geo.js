// Geo helpers: afstanden, WKT-polygonen en punt-in-polygoon.
// Coördinaten intern als { lat, lon }; ringen als [[lon, lat], ...] (zoals WKT/GeoJSON).

const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// "POLYGON ((x y, x y), (hole))" of "MULTIPOLYGON (((...)), ((...)))" -> [[ring, ring...], ...]
export function parseWKT(wkt) {
  if (!wkt) return [];
  const text = wkt.trim().toUpperCase();
  const parseRing = (s) =>
    s
      .split(',')
      .map((p) => p.trim().split(/\s+/).map(Number))
      .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map(([x, y]) => [x, y]);
  const parsePolygonBody = (body) => {
    // body = "(x y, ...), (x y, ...)"
    const rings = [];
    const re = /\(([^()]+)\)/g;
    let m;
    while ((m = re.exec(body))) rings.push(parseRing(m[1]));
    return rings.filter((r) => r.length >= 3);
  };
  if (text.startsWith('MULTIPOLYGON')) {
    const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const polys = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '(') {
        if (depth === 0) start = i;
        depth++;
      } else if (c === ')') {
        depth--;
        if (depth === 0 && start >= 0) {
          polys.push(parsePolygonBody(inner.slice(start + 1, i)));
          start = -1;
        }
      }
    }
    return polys.filter((p) => p.length);
  }
  if (text.startsWith('POLYGON')) {
    const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const p = parsePolygonBody(inner);
    return p.length ? [p] : [];
  }
  return [];
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(pt, polygon) {
  const [outer, ...holes] = polygon;
  if (!outer || !pointInRing(pt.lon, pt.lat, outer)) return false;
  return !holes.some((h) => pointInRing(pt.lon, pt.lat, h));
}

export function pointInAny(pt, polygons) {
  return polygons.some((p) => pointInPolygon(pt, p));
}

// Dichtstbijzijnde punt op de rand van een set polygonen (lokale equirectangulaire projectie).
export function nearestOnPolygons(pt, polygons) {
  const kx = Math.cos(toRad(pt.lat)) * 111320;
  const ky = 110574;
  let best = null;
  for (const poly of polygons) {
    if (pointInPolygon(pt, poly)) return { lat: pt.lat, lon: pt.lon, distM: 0, inside: true };
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const ax = (ring[i][0] - pt.lon) * kx;
        const ay = (ring[i][1] - pt.lat) * ky;
        const bx = (ring[i + 1][0] - pt.lon) * kx;
        const by = (ring[i + 1][1] - pt.lat) * ky;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx;
        const py = ay + t * dy;
        const d = Math.hypot(px, py);
        if (!best || d < best.distM) {
          best = { lat: pt.lat + py / ky, lon: pt.lon + px / kx, distM: d, inside: false };
        }
      }
    }
  }
  return best;
}

export function inBBox(pt, bbox) {
  return pt.lat >= bbox.south && pt.lat <= bbox.north && pt.lon >= bbox.west && pt.lon <= bbox.east;
}

// Vereenvoudig een ring voor de kaart (Douglas-Peucker light: elke n-de punt + behoud vorm grof).
export function roundRing(ring, decimals = 6) {
  const f = 10 ** decimals;
  return ring.map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
}
