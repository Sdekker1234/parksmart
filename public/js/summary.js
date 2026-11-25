// Pure logica rond de zoekstatus, gedeeld door de app (app.js) en het testprogramma van de
// assistent (scripts/eval-bot.js). Geen DOM: alles werkt op een gewoon state-object.
import { duration } from './format.js';

export const ALL_TYPES = ['garage', 'street', 'pr', 'free'];
export const DEFAULT_WALK = 20;
export const clampDuration = (m) => Math.min(7 * 1440, Math.max(15, Math.round(m / 15) * 15));
export const shortLabel = (s) => String(s || '').replace(/, 's-Hertogenbosch$/, '');
export const clockTime = (ts) => new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });

// Hoe actueel zijn de tarieven? De zones (RDW) worden elke nacht ververst. Zijn ze ouder dan twee
// dagen, dan zegt de app dat hij niet zeker weet of de prijzen nog kloppen.
export const STALE_AFTER_MS = 48 * 3600e3;
export function ratesFreshness(status, now = Date.now()) {
  const at = status?.data?.rdw?.savedAt;
  if (!at) return null;
  const check = status.refresh?.sources?.rdw;
  return {
    at,
    stale: now - at > STALE_AFTER_MS,
    lastCheckFailed: Boolean(check && !check.ok),
    checkedAt: status.refresh?.checkedAt ?? null,
    dateLabel: new Date(at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' }),
    timeLabel: clockTime(at),
  };
}

// Zoekresultaat (adres, snelkeuze of bedrijf) -> bestemming. Bedrijven hebben extra info (categorie, openingstijden).
export function toDest(r, extra = {}) {
  const isPlace = String(r.id || '').startsWith('place-');
  return {
    lat: r.lat,
    lon: r.lon,
    label: shortLabel(r.label),
    place: isPlace ? { name: r.name, kind: r.kind, address: r.address, hours: r.hours, hoursNl: r.hoursNl, id: r.id } : null,
    alternatives: r.alternatives ?? [],
    note: r.note ?? null,
    ...extra,
  };
}

// Zet bestemming, tijd en filters in de state. `undefined` = niet wijzigen. nowIso = "YYYY-MM-DDTHH:MM".
export function applySearchParams(state, { dest, durationMin, arrival, maxPrice, maxWalk, types, sort }, nowIso) {
  if (durationMin) state.durationMin = clampDuration(durationMin);
  if (arrival !== undefined) {
    if (arrival) {
      state.arrival = arrival < nowIso ? nowIso : arrival.slice(0, 16);
      state.arrivalMode = 'later';
    } else {
      state.arrivalMode = 'now';
    }
  }
  if (maxPrice !== undefined) state.filters.maxPrice = maxPrice == null ? null : Math.min(40, Math.max(0, Math.round(maxPrice)));
  if (maxWalk !== undefined) state.filters.maxWalk = maxWalk == null ? DEFAULT_WALK : Math.min(40, Math.max(2, Math.round(maxWalk)));
  if (types !== undefined) state.filters.types = new Set(types?.length ? types.filter((t) => ALL_TYPES.includes(t)) : ALL_TYPES);
  if (!state.filters.types.size) state.filters.types = new Set(ALL_TYPES);
  if (sort !== undefined) state.sort = sort || 'price';
  if (dest) state.dest = dest;
}

const byPrice = (a, b) => (a.price.known ? 0 : 1) - (b.price.known ? 0 : 1) || (a.price.total ?? 0) - (b.price.total ?? 0) || a.walk.minutes - b.walk.minutes;

// Welke opties zichtbaar zijn met de huidige filters, en welke afvallen (maximale parkeerduur).
export function visibleOptions(state) {
  const all = state.results?.options ?? [];
  const f = state.filters;
  const list = [];
  const excluded = [];
  for (const o of all) {
    if (!f.types.has(o.type)) continue;
    if (!o.shuttle && f.maxWalk != null && o.walk.minutes > f.maxWalk) continue;
    if (!o.price.feasible) {
      excluded.push(o);
      continue;
    }
    const known = o.price.known;
    if (!known && !f.showUnknown) continue;
    if (known && f.maxPrice != null && o.price.total > f.maxPrice) continue;
    list.push(o);
  }
  const byWalk = (a, b) => (a.shuttle ? 1 : 0) - (b.shuttle ? 1 : 0) || a.walk.minutes - b.walk.minutes || byPrice(a, b);
  list.sort(state.sort === 'walk' ? byWalk : byPrice);
  const cheapest = [...list].filter((o) => o.price.known).sort(byPrice)[0] ?? null;
  return { list, excluded, cheapest };
}

// Compacte, feitelijke samenvatting van een optie (voor de assistent).
export function optionFacts(o) {
  const known = o.price.known && o.price.feasible;
  return {
    id: o.id,
    name: o.name,
    kind: o.kind,
    total_eur: known ? o.price.total : null,
    ...(known ? {} : { price_note: o.price.reason }),
    per_hour_eur: known ? o.price.perHour ?? null : null,
    ...(o.shuttle ? { shuttle: true, distance_km: Math.round(o.walk.straightM / 100) / 10 } : { walk_minutes: o.walk.minutes, walk_meters: o.walk.meters }),
    source_trust: o.price.estimated ? 'estimate' : o.source.trust,
    ...(o.live ? { occupancy: { vacant: o.live.vacant, capacity: o.live.capacity, reading_time: clockTime(o.live.updatedAt) } } : {}),
    ...(o.notes?.length ? { notes: o.notes.slice(0, 2) } : {}),
    ...(o.warnings?.length ? { warnings: o.warnings.slice(0, 1) } : {}),
  };
}

export function buildSummary(state) {
  const { list, excluded, cheapest } = visibleOptions(state);
  const top = [...list].sort(byPrice).slice(0, 8);
  const closest = [...list].filter((o) => !o.shuttle && o.price.known && !top.includes(o)).sort((a, b) => a.walk.minutes - b.walk.minutes).slice(0, 2);
  const d = state.dest;
  return {
    destination: {
      label: d.label,
      ...(d.place ? { name: d.place.name, category: d.place.kind, address: d.place.address, opening_hours_osm: d.place.hours ?? null } : {}),
      ...(d.alternatives?.length ? { other_branches: d.alternatives.slice(0, 4).map((a) => a.label) } : {}),
    },
    arrival: state.results.arrival,
    duration_minutes: state.durationMin,
    duration_label: duration(state.durationMin),
    filters: { max_price_eur: state.filters.maxPrice, max_walk_minutes: state.filters.maxWalk, types: [...state.filters.types], sort: state.sort },
    options_in_list: list.length,
    cheapest_id: cheapest?.id ?? null,
    options: top.map(optionFacts),
    ...(closest.length ? { closest_other_options: closest.map(optionFacts) } : {}),
    ...(excluded.length ? { not_possible_for_this_duration: excluded.slice(0, 3).map((o) => ({ name: o.name, reason: o.price.reason })) } : {}),
  };
}
