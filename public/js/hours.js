// Openingstijden in OpenStreetMap-notatie ("Mo-Sa 09:00-18:00; Su 12:00-17:00") lezen en toetsen.
// Ondersteunt de gangbare vormen: dagen/dagbereiken, meerdere tijdvakken, 24/7, off/closed.
// Maanden, weeknummers en feestdagen (PH) slaan we over; bij twijfel geven we null terug.

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const NL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mo..Su voor bereiken als "Fr-Mo"

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const fmt = (m) => (m >= 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

function parseDays(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((s) => s.trim());
    const ia = DAYS.indexOf(a);
    if (ia < 0) return null;
    if (!b) {
      out.add(ia);
      continue;
    }
    const ib = DAYS.indexOf(b);
    if (ib < 0) return null;
    let i = ORDER.indexOf(ia);
    for (let guard = 0; guard < 7; guard++) {
      out.add(ORDER[i]);
      if (ORDER[i] === ib) break;
      i = (i + 1) % 7;
    }
  }
  return out;
}

// -> array van 7 (0 = zondag) met [[van, tot], ...] in minuten, of null als we het niet snappen.
export function parseOpeningHours(text) {
  if (!text) return null;
  const s = String(text).trim();
  if (s === '24/7') return Array.from({ length: 7 }, () => [[0, 1440]]);
  const week = Array.from({ length: 7 }, () => null);
  let any = false;
  for (const raw of s.split(';')) {
    const rule = raw.trim();
    if (!rule) continue;
    if (/^PH\b/.test(rule)) continue; // feestdagen: overslaan
    const m = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)?(?:\s*,\s*PH)?\s*(.*)$/.exec(rule);
    if (!m) return null;
    const days = m[1] ? parseDays(m[1].replace(/\s+/g, '')) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    const rest = m[2].trim();
    let intervals;
    if (/^(off|closed)$/i.test(rest)) intervals = [];
    else if (rest === '24/7' || rest === '00:00-24:00') intervals = [[0, 1440]];
    else {
      intervals = [];
      for (const span of rest.split(',')) {
        const [a, b] = span.trim().split('-');
        const from = toMin(a?.trim());
        let to = toMin(b?.trim());
        if (from == null || to == null) return null;
        if (to <= from) to = 1440; // over middernacht: rekenen tot 24:00
        intervals.push([from, to]);
      }
    }
    for (const d of days) week[d] = intervals; // latere regel overschrijft (OSM-regel)
    any = true;
  }
  return any ? week.map((x) => x ?? []) : null;
}

export function describeDay(week, dow) {
  const iv = week?.[dow];
  if (!iv) return null;
  return iv.length ? iv.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(' en ') : 'gesloten';
}

// arrival = Date met NL-wandklok in de lokale velden (zoals de app hem toont); durationMin = parkeerduur.
// -> { status: 'open' | 'closed' | 'closes_during' | 'opens_later', dayName, hours, closesAt, opensAt }
export function checkVisit(text, arrival, durationMin) {
  const week = parseOpeningHours(text);
  if (!week) return null;
  const dow = arrival.getDay();
  const t = arrival.getHours() * 60 + arrival.getMinutes();
  const iv = week[dow];
  const base = { dayName: NL[dow], hours: describeDay(week, dow) };
  if (!iv.length) return { ...base, status: 'closed' };
  const now = iv.find(([a, b]) => t >= a && t < b);
  if (now) {
    const end = t + durationMin;
    return end > now[1] ? { ...base, status: 'closes_during', closesAt: fmt(now[1]) } : { ...base, status: 'open', closesAt: fmt(now[1]) };
  }
  const next = iv.find(([a]) => a > t);
  return next ? { ...base, status: 'opens_later', opensAt: fmt(next[0]) } : { ...base, status: 'closed' };
}
