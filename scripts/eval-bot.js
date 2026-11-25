// Test de ingebouwde assistent met de testset uit bot-scenarios.js.
// Draait exact dezelfde code als de app (smart-assistant.js + summary.js + de rekenmotor),
// maar zonder browser. Gebruik: npm run eval:bot   (optioneel: -- --verbose, -- "naam")
import { loadRdw, uuidByArea } from '../server/rdw.js';
import { loadSpdp } from '../server/spdp.js';
import { loadOsm } from '../server/osm.js';
import { loadPlaces } from '../server/places.js';
import { search } from '../server/search.js';
import { searchOne, suggest } from '../server/geocode.js';
import { parseRules } from '../server/rules.js';
import { parseArrival } from '../server/pricing.js';
import { inBBox } from '../server/geo.js';
import { CITY } from '../server/config.js';
import { createSmartAssistant } from '../public/js/smart-assistant.js';
import { ALL_TYPES, DEFAULT_WALK, toDest, applySearchParams, buildSummary } from '../public/js/summary.js';
import { localIso, nowRounded } from '../public/js/format.js';
import { SCENARIOS, HOLDOUT, AI_SCENARIOS, AI_HOLDOUT, AI_KNOWN_FAILS, HONESTY } from './bot-scenarios.js';
import { createNodeSemantic } from './semantic-node.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.find((a) => !a.startsWith('--'));
// Standaard draait het AI-model mee (eenmalig ±135 MB downloaden). Zonder: -- --zonder-ai
const useAi = !args.includes('--zonder-ai');
const SET = (args.includes('--holdout') ? [...HOLDOUT, ...AI_HOLDOUT] : args.includes('--all') ? [...SCENARIOS, ...HOLDOUT, ...AI_SCENARIOS, ...AI_HOLDOUT, ...AI_KNOWN_FAILS, ...HONESTY] : [...SCENARIOS, ...AI_SCENARIOS, ...HONESTY]).filter((sc) => useAi || !sc.ai);
const semantic = useAi ? createNodeSemantic() : null;
if (semantic) await semantic.enable();

await loadRdw({ fast: true });
const extra = [...uuidByArea().entries()].filter(([id]) => id.startsWith(`${CITY.areaManagerId}_`)).map(([, u]) => u);
await Promise.all([loadSpdp(extra, { fast: true }), loadOsm({ fast: true }), loadPlaces({ fast: true })]);

// Nederlandse wandklok als UTC-Date (zoals de server en local-api.js dat doen)
function nowNL() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
}

function makeSession() {
  const state = {
    dest: null,
    durationMin: 120,
    arrivalMode: 'now',
    arrival: null,
    filters: { maxPrice: null, maxWalk: DEFAULT_WALK, types: new Set(ALL_TYPES), showUnknown: true },
    sort: 'price',
    results: null,
    selectedId: null,
  };
  const api = {
    async aiParse(text) {
      const p = parseRules(String(text).slice(0, 500), nowNL());
      const place = p.destination && !(p.topic === 'off_topic' && p.destination_guess) ? await searchOne(p.destination) : null;
      return { ...p, source: 'rules', place, placeInCity: place ? inBBox(place, CITY.bbox) : null };
    },
    geocode: async (q) => ({ result: await searchOne(q) }),
    suggest: async (q) => ({ results: await suggest(q) }),
  };
  async function applySearch(params) {
    applySearchParams(state, params, localIso(nowRounded()));
    if (!state.dest) return { ok: false, message: 'Er is nog geen bestemming gekozen.' };
    if (!inBBox(state.dest, CITY.bbox)) return { ok: false, message: 'ParkSmart werkt voorlopig alleen in Den Bosch.' };
    const arrivalIso = state.arrivalMode === 'now' ? localIso(nowRounded()) : state.arrival;
    const options = await search({ dest: state.dest, arrival: parseArrival(arrivalIso), durationMin: state.durationMin });
    state.results = { arrival: arrivalIso, durationMin: state.durationMin, options };
    return { ok: true };
  }
  const findOption = (id) => state.results?.options.find((o) => o.id === id) ?? null;
  const navUrl = (o) => `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lon}`;
  const bot = createSmartAssistant({ api, state, applySearch, searchSummary: () => buildSummary(state), findOption, toDest, localIso, nowRounded, navUrl, semantic });
  return { state, bot };
}

// ---------- Verwachtingen controleren ----------
const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const ymd = (d) => localIso(d).slice(0, 10);
function resolveDate(spec) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const add = (n) => ymd(new Date(today.getTime() + n * 86400e3));
  if (spec === 'vandaag') return add(0);
  if (spec === 'morgen') return add(1);
  const next = /^volgende (\w+)$/.exec(spec);
  const day = DAYS.indexOf(next ? next[1] : spec);
  if (day < 0) return spec;
  if (!next) return add((day - today.getDay() + 7) % 7); // eerstvolgende (vandaag telt mee)
  // "volgende week zaterdag" = die dag in de volgende kalenderweek (ma t/m zo)
  const toMonday = (8 - today.getDay()) % 7 || 7;
  return add(toMonday + ((day + 6) % 7));
}

function check(expect, res, state) {
  const fails = [];
  const arrival = state.arrivalMode === 'now' ? localIso(nowRounded()) : state.arrival;
  if (expect.intent) {
    const ok = Array.isArray(expect.intent) ? expect.intent.includes(res.intent) : res.intent === expect.intent;
    if (!ok) fails.push(`intent ${res.intent} ≠ ${expect.intent}`);
  }
  if (expect.dest && !expect.dest.test(state.dest?.label ?? '')) fails.push(`bestemming "${state.dest?.label ?? '-'}" ≠ ${expect.dest}`);
  if (expect.duration && state.durationMin !== expect.duration) fails.push(`duur ${state.durationMin} ≠ ${expect.duration}`);
  if (expect.date && arrival?.slice(0, 10) !== resolveDate(expect.date)) fails.push(`datum ${arrival?.slice(0, 10)} ≠ ${expect.date} (${resolveDate(expect.date)})`);
  if (expect.time && arrival?.slice(11, 16) !== expect.time) fails.push(`tijd ${arrival?.slice(11, 16)} ≠ ${expect.time}`);
  if (expect.types) {
    const got = [...state.filters.types].sort().join(',');
    if (got !== [...expect.types].sort().join(',')) fails.push(`soorten ${got} ≠ ${expect.types.join(',')}`);
  }
  if (expect.maxWalk !== undefined && state.filters.maxWalk !== expect.maxWalk) fails.push(`max lopen ${state.filters.maxWalk} ≠ ${expect.maxWalk}`);
  if (expect.maxPrice !== undefined && state.filters.maxPrice !== expect.maxPrice) fails.push(`max prijs ${state.filters.maxPrice} ≠ ${expect.maxPrice}`);
  if (expect.results && !(res.results?.options ?? []).some((o) => o.total_eur != null)) fails.push('geen opties met prijs');
  if (expect.text && !expect.text.test(res.text ?? '')) fails.push(`tekst mist ${expect.text}`);
  if (expect.notText && expect.notText.test(res.text ?? '')) fails.push(`tekst bevat ${expect.notText}`);
  return fails;
}

// ---------- Draaien ----------
// Gevallen met knownFail zijn bewust falende gevallen: bekende grenzen die we documenteren (faalanalyse).
// Die tellen apart en laten de test niet mislukken; lukt zo'n geval ineens wel, dan melden we dat.
let turns = 0;
let passed = 0;
let knownTurns = 0;
let knownStillFailing = 0;
const failures = [];
const fixedKnown = [];
const oneLine = (s, n) => String(s).replace(/\s+/g, ' ').slice(0, n);
for (const sc of SET) {
  if (only && !sc.name.includes(only)) continue;
  const { state, bot } = makeSession();
  for (const [i, turn] of sc.turns.entries()) {
    let res;
    try {
      res = await bot.turn(turn.q);
    } catch (err) {
      res = { intent: 'CRASH', text: err.stack };
    }
    const fails = check(turn.expect, res, state);
    if (sc.knownFail) {
      knownTurns++;
      if (fails.length) knownStillFailing++;
      else fixedKnown.push(sc.name);
    } else {
      turns++;
      if (!fails.length) passed++;
      else failures.push({ sc: sc.name, i, q: turn.q, fails, text: res.text });
    }
    if (verbose || fails.length || sc.knownFail) {
      const mark = sc.knownFail ? (fails.length ? '⚠' : '★') : fails.length ? '✖' : '✔';
      console.log(`${mark} [${sc.name} #${i + 1}] "${turn.q}" -> ${res.intent} | ${state.dest?.label ?? '-'} | ${state.durationMin} min | ${state.arrivalMode === 'now' ? 'nu' : state.arrival}`);
      if (sc.knownFail && fails.length) console.log(`    bekende grens: ${sc.knownFail}\n    antwoord: ${oneLine(res.text, 160)}`);
      else if (sc.knownFail) console.log('    lukt nu wel: haal dit geval uit de bekende grenzen');
      else if (fails.length) console.log(`    ${fails.join('\n    ')}\n    antwoord: ${oneLine(res.text, 220)}`);
    }
  }
}
console.log(`\n${passed}/${turns} beurten goed (${Math.round((passed / turns) * 100)}%)${useAi ? ', met AI-model' : ', zonder AI-model'}`);
if (knownTurns) console.log(`Bekende grenzen: ${knownStillFailing} van ${knownTurns} falen zoals verwacht${fixedKnown.length ? `; lukt nu wel: ${fixedKnown.join(', ')}` : ''}`);
process.exitCode = failures.length ? 1 : 0;
