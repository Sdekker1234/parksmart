// ParkSmart frontend: zoeken, filteren, kaart en advies.
import { api } from './api.js';
import { createMap } from './map.js';
import { eur, eurShort, duration, distance, localIso, nowRounded, arrivalLabel, timeAgo, esc } from './format.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const DUR_CHIPS = [30, 60, 120, 180, 240, 480, 1440];
const QUICK_IDS = ['lm-markt', 'lm-sintjan', 'lm-station', 'lm-parade', 'lm-jbz', 'lm-brabanthallen', 'lm-vliert'];
const DEFAULT_WALK = 20;
const TRUST = {
  official: ['Officieel', 'trust-official'],
  operator: ['Exploitant', 'trust-operator'],
  community: ['Community', 'trust-community'],
  estimate: ['Schatting', 'trust-community'],
};
const ICON = {
  walk: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2" fill="currentColor"/><path d="M10 21l2-6 2.5 2.5V21M8 12l2-4h3l2 3 3 1M10 8l-2 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bus: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 11h16M7 21v-3M17 21v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  car: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2M4 11h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z" fill="currentColor"/></svg>',
  nav: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z" fill="currentColor"/></svg>',
};

const state = {
  status: null,
  dest: null,
  durationMin: 120,
  arrivalMode: 'now',
  arrival: null,
  filters: { maxPrice: null, maxWalk: DEFAULT_WALK, types: new Set(['garage', 'street', 'pr', 'free']), showUnknown: true },
  sort: 'price',
  results: null,
  selectedId: null,
  openId: null,
  routes: new Map(),
  advice: null,
  zonesDate: null,
};

let mapApi;
let searchCtl;
let adviceCtl;
let adviceTimer;

// ---------- Init ----------
init();

async function init() {
  bindUi();
  renderDurChips();
  syncDuration();
  try {
    state.status = await api.status();
  } catch {
    showMessage('De ParkSmart-server reageert niet. Draait `npm start` nog?', true);
    return;
  }
  const s = state.status;
  mapApi = createMap($('#map'), s.city.center, { onMapClick: pickOnMap, onMarkerClick: (id) => select(id, { open: true, scroll: true }) });
  renderQuick();
  renderDataLine();
  renderAiStatus();
  loadZones(s.now.slice(0, 10));
  window.addEventListener('resize', () => mapApi.invalidate());
  restoreFromHash();
}

async function loadZones(date) {
  if (state.zonesDate === date) return;
  state.zonesDate = date;
  try {
    const { zones } = await api.zones(date);
    mapApi.setZones(zones);
    if (state.selectedId?.startsWith('zone:')) mapApi.highlightZone(state.selectedId.slice(5));
  } catch {
    state.zonesDate = null;
  }
}

// ---------- UI-koppelingen ----------
function bindUi() {
  // Tabs
  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => {
      const ai = tab.id === 'tabAi';
      $('#tabSearch').classList.toggle('is-active', !ai);
      $('#tabAi').classList.toggle('is-active', ai);
      $('#tabSearch').setAttribute('aria-selected', String(!ai));
      $('#tabAi').setAttribute('aria-selected', String(ai));
      $('#paneSearch').hidden = ai;
      $('#paneAi').hidden = !ai;
      (ai ? $('#aiInput') : $('#destInput')).focus();
    });
  }

  // Bestemming + suggesties
  const input = $('#destInput');
  let sugTimer;
  let sugCtl;
  let active = -1;
  let items = [];
  const list = $('#suggestions');
  const closeList = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const renderList = () => {
    list.innerHTML = items
      .map((r, i) => `<li role="option" id="sug-${i}" aria-selected="${i === active}"><span>${esc(r.label)}</span><span class="s-kind">${esc(r.kind)}</span></li>`)
      .join('');
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!!items.length));
    input.setAttribute('aria-activedescendant', active >= 0 ? `sug-${active}` : '');
  };
  const choose = (r) => {
    closeList();
    setDestination({ lat: r.lat, lon: r.lon, label: r.label.replace(/, 's-Hertogenbosch$/, '') });
  };
  input.addEventListener('input', () => {
    clearTimeout(sugTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      items = [];
      return closeList();
    }
    sugTimer = setTimeout(async () => {
      sugCtl?.abort();
      sugCtl = new AbortController();
      try {
        items = (await api.suggest(q, sugCtl.signal)).results;
        active = -1;
        renderList();
      } catch {
        /* afgebroken of offline */
      }
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden && e.key === 'Enter') {
      e.preventDefault();
      return geocodeFree(input.value);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(items.length - 1, active + 1);
      renderList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, active - 1);
      renderList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active >= 0 ? active : 0]) choose(items[active >= 0 ? active : 0]);
    } else if (e.key === 'Escape') {
      closeList();
    }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    choose(items[[...list.children].indexOf(li)]);
  });
  input.addEventListener('blur', () => setTimeout(closeList, 120));

  $('#locateBtn').addEventListener('click', useMyLocation);

  // AI
  $('#paneAi').addEventListener('submit', (e) => {
    e.preventDefault();
    aiSubmit($('#aiInput').value);
  });
  $('#aiInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      aiSubmit($('#aiInput').value);
    }
  });

  // Duur
  $('#durMinus').addEventListener('click', () => stepDuration(-1));
  $('#durPlus').addEventListener('click', () => stepDuration(1));

  // Aankomst
  $('#arrNow').addEventListener('click', () => setArrivalMode('now'));
  $('#arrLater').addEventListener('click', () => setArrivalMode('later'));
  $('#arrInput').addEventListener('change', (e) => {
    if (!e.target.value) return;
    state.arrival = e.target.value;
    scheduleSearch();
  });

  // Filters
  $('#fPrice').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    state.filters.maxPrice = v >= 41 ? null : v;
    syncFilters();
    render();
  });
  $('#fWalk').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    state.filters.maxWalk = v >= 41 ? null : v;
    syncFilters();
    render();
  });
  for (const chip of $$('#typeChips .chip')) {
    chip.addEventListener('click', () => {
      const t = chip.dataset.type;
      const types = state.filters.types;
      if (types.has(t) && types.size === 1) return; // minstens één soort
      types.has(t) ? types.delete(t) : types.add(t);
      syncFilters();
      render();
    });
  }
  $('#fUnknown').addEventListener('change', (e) => {
    state.filters.showUnknown = e.target.checked;
    syncFilters();
    render();
  });

  // Sorteren
  for (const b of $$('[data-sort]')) {
    b.addEventListener('click', () => {
      state.sort = b.dataset.sort;
      syncSort();
      render({ advice: false });
    });
  }

  // Info
  $('#infoBtn').addEventListener('click', () => $('#infoDialog').showModal());
}

function renderQuick() {
  const lms = state.status.landmarks.filter((l) => QUICK_IDS.includes(l.id)).sort((a, b) => QUICK_IDS.indexOf(a.id) - QUICK_IDS.indexOf(b.id));
  $('#quickDest').innerHTML = lms.map((l) => `<button type="button" class="chip" data-lm="${l.id}">${esc(l.label.replace("Station 's-Hertogenbosch", 'Station'))}</button>`).join('');
  for (const b of $$('#quickDest .chip')) {
    b.addEventListener('click', () => {
      const l = lms.find((x) => x.id === b.dataset.lm);
      setDestination({ lat: l.lat, lon: l.lon, label: l.label });
    });
  }
}

// ---------- Duur & aankomst ----------
function renderDurChips() {
  $('#durChips').innerHTML = DUR_CHIPS.map(
    (m) => `<button type="button" class="chip" data-min="${m}" aria-pressed="false">${m < 60 ? `${m} min` : `${m / 60} uur`}</button>`,
  ).join('');
  for (const b of $$('#durChips .chip')) {
    b.addEventListener('click', () => {
      state.durationMin = Number(b.dataset.min);
      syncDuration();
      scheduleSearch();
    });
  }
}

function stepDuration(dir) {
  const m = state.durationMin;
  const ref = dir > 0 ? m : m - 1; // stapgrootte: tot 4 uur per kwartier, tot 12 uur per half uur, daarna per uur
  const step = ref < 240 ? 15 : ref < 720 ? 30 : 60;
  state.durationMin = Math.min(7 * 1440, Math.max(15, Math.round((m + dir * step) / step) * step));
  syncDuration();
  scheduleSearch();
}

function syncDuration() {
  $('#durOut').textContent = duration(state.durationMin);
  for (const b of $$('#durChips .chip')) {
    const on = Number(b.dataset.min) === state.durationMin;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

function setArrivalMode(mode, { search = true } = {}) {
  state.arrivalMode = mode;
  const later = mode === 'later';
  $('#arrNow').classList.toggle('is-active', !later);
  $('#arrLater').classList.toggle('is-active', later);
  $('#arrNow').setAttribute('aria-pressed', String(!later));
  $('#arrLater').setAttribute('aria-pressed', String(later));
  const inp = $('#arrInput');
  inp.hidden = !later;
  inp.min = localIso(nowRounded());
  if (later) {
    if (!state.arrival) {
      const d = nowRounded(15);
      d.setMinutes(d.getMinutes() + 60);
      state.arrival = localIso(d);
    }
    inp.value = state.arrival;
  }
  if (search) scheduleSearch();
}

const currentArrival = () => (state.arrivalMode === 'now' ? localIso(nowRounded()) : state.arrival);

// ---------- Filters ----------
function syncFilters() {
  const f = state.filters;
  $('#fPriceOut').textContent = f.maxPrice == null ? 'geen' : eur(f.maxPrice);
  $('#fWalkOut').textContent = f.maxWalk == null ? 'geen' : `${f.maxWalk} min`;
  $('#fPrice').value = f.maxPrice == null ? 41 : f.maxPrice;
  $('#fWalk').value = f.maxWalk == null ? 41 : f.maxWalk;
  for (const chip of $$('#typeChips .chip')) {
    const on = f.types.has(chip.dataset.type);
    chip.classList.toggle('is-on', on);
    chip.setAttribute('aria-pressed', String(on));
  }
  $('#fUnknown').checked = f.showUnknown;
  const n = (f.maxPrice != null) + (f.maxWalk !== DEFAULT_WALK) + (f.types.size < 4) + !f.showUnknown;
  $('#filterCount').textContent = n ? String(n) : '';
}

function syncSort() {
  for (const b of $$('[data-sort]')) {
    const on = b.dataset.sort === state.sort;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

// ---------- Bestemming ----------
function setDestination(dest, { search = true } = {}) {
  state.dest = dest;
  $('#destInput').value = dest.label || '';
  $('#mapHint').hidden = true;
  mapApi.setDestination(dest);
  if (search) runSearch({ fit: true });
}

async function geocodeFree(text) {
  const q = text.trim();
  if (q.length < 2) return;
  try {
    const { result } = await api.geocode(q);
    if (!result) return showMessage(`Ik kan "${q}" niet vinden in Den Bosch. Probeer een straatnaam of kies een punt op de kaart.`, true);
    setDestination({ lat: result.lat, lon: result.lon, label: result.label.replace(/, 's-Hertogenbosch$/, '') });
  } catch {
    showMessage('Zoeken lukt nu niet. Controleer je internetverbinding.', true);
  }
}

async function pickOnMap(pt) {
  setDestination({ ...pt, label: 'Gekozen punt op de kaart' });
  try {
    const r = await api.reverse(pt.lat, pt.lon);
    if (r.label && state.dest?.lat === pt.lat) {
      state.dest.label = r.label.replace(/, 's-Hertogenbosch$/, '');
      $('#destInput').value = state.dest.label;
      updateHash();
    }
  } catch {
    /* label is bijzaak */
  }
}

function useMyLocation() {
  if (!navigator.geolocation) return showMessage('Je browser ondersteunt geen locatiebepaling.', true);
  const btn = $('#locateBtn');
  btn.classList.add('is-busy');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      btn.classList.remove('is-busy');
      const pt = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const r = await api.reverse(pt.lat, pt.lon).catch(() => ({}));
      if (r.inCity === false) return showMessage('Je huidige locatie ligt buiten Den Bosch. Kies een bestemming in Den Bosch.', true);
      setDestination({ ...pt, label: r.label ? `Mijn locatie (${r.label.replace(/, 's-Hertogenbosch$/, '')})` : 'Mijn locatie' });
    },
    (err) => {
      btn.classList.remove('is-busy');
      showMessage(err.code === 1 ? 'Locatietoegang geweigerd. Typ je bestemming of tik op de kaart.' : 'Je locatie kon niet worden bepaald.', true);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

// ---------- AI-zoekvraag ----------
async function aiSubmit(text) {
  const t = text.trim();
  if (t.length < 3) return;
  const btn = $('#aiSubmit');
  const echo = $('#aiEcho');
  btn.disabled = true;
  btn.textContent = 'Even denken…';
  try {
    const r = await api.aiParse(t);
    if (r.duration_minutes) {
      state.durationMin = Math.min(7 * 1440, Math.max(15, Math.round(r.duration_minutes / 15) * 15));
      syncDuration();
    }
    if (r.date || r.time) {
      const now = localIso(nowRounded());
      const date = r.date || now.slice(0, 10);
      const time = r.time || (r.date && r.date !== now.slice(0, 10) ? '10:00' : now.slice(11, 16));
      state.arrival = `${date}T${time}`;
      if (state.arrival < now) state.arrival = now;
      setArrivalMode('later', { search: false });
    }
    if (r.max_price_eur != null) state.filters.maxPrice = Math.min(40, Math.max(0, Math.round(r.max_price_eur)));
    if (r.max_walk_minutes != null) state.filters.maxWalk = Math.min(40, Math.max(2, Math.round(r.max_walk_minutes)));
    if (r.types?.length) state.filters.types = new Set(r.types);
    if (r.sort) state.sort = r.sort;
    syncFilters();
    syncSort();
    const via = r.source === 'ai' ? 'begrepen door Claude' : r.limited ? 'AI-limiet bereikt, begrepen met ingebouwde regels' : 'begrepen met ingebouwde regels';
    let msg = `${esc(r.summary)} <small>(${via})</small>`;
    if (r.place && r.placeInCity === false) {
      msg += '<br>Die plek ligt buiten Den Bosch. ParkSmart werkt voorlopig alleen in Den Bosch.';
    } else if (r.place) {
      setDestination({ lat: r.place.lat, lon: r.place.lon, label: r.place.label.replace(/, 's-Hertogenbosch$/, '') }, { search: false });
    } else if (r.destination) {
      msg += `<br>Ik kon "${esc(r.destination)}" niet op de kaart vinden. Tik op de kaart of typ een adres.`;
    } else if (!state.dest) {
      msg += '<br>Waar wil je heen? Noem een plek of tik op de kaart.';
    }
    echo.innerHTML = msg;
    echo.hidden = false;
    if (state.dest) runSearch({ fit: true });
  } catch {
    echo.textContent = 'Dat lukte niet. Probeer het opnieuw of gebruik het tabblad Bestemming.';
    echo.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Zoek';
  }
}

// ---------- Zoeken ----------
let searchTimer;
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch({ fit: false }), 250);
}

async function runSearch({ fit = false } = {}) {
  if (!state.dest) return;
  searchCtl?.abort();
  searchCtl = new AbortController();
  const arrival = currentArrival();
  $('#results').setAttribute('aria-busy', 'true');
  $('#resultsCount').textContent = 'Prijzen berekenen…';
  try {
    const res = await api.search({ lat: state.dest.lat.toFixed(6), lon: state.dest.lon.toFixed(6), arrival, duration: state.durationMin }, searchCtl.signal);
    state.results = res;
    state.selectedId = null;
    state.openId = null;
    state.advice = null;
    mapApi.clearRoute();
    mapApi.highlightZone(null);
    loadZones(arrival.slice(0, 10));
    render({ fit });
    updateHash();
  } catch (err) {
    if (err.name === 'AbortError') return;
    state.results = null;
    render();
    showMessage(err.body?.error === 'outside' ? err.message : 'Ophalen van parkeeropties mislukt. Probeer het zo opnieuw.', true);
  } finally {
    $('#results').removeAttribute('aria-busy');
  }
}

function visible() {
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
  const byPrice = (a, b) => {
    const ka = a.price.known ? 0 : 1;
    const kb = b.price.known ? 0 : 1;
    return ka - kb || (a.price.total ?? 0) - (b.price.total ?? 0) || a.walk.minutes - b.walk.minutes;
  };
  const byWalk = (a, b) => (a.shuttle ? 1 : 0) - (b.shuttle ? 1 : 0) || a.walk.minutes - b.walk.minutes || byPrice(a, b);
  list.sort(state.sort === 'walk' ? byWalk : byPrice);
  const cheapest = [...list].filter((o) => o.price.known).sort(byPrice)[0] ?? null;
  return { list, excluded, cheapest };
}

// ---------- Renderen ----------
function render({ fit = false, advice = true } = {}) {
  const has = Boolean(state.results);
  $('#empty').hidden = has;
  $('#empty').classList.remove('is-error');
  $('#resultsHead').hidden = !has;
  if (!has) {
    $('#results').innerHTML = '';
    $('#excluded').hidden = true;
    $('#advice').hidden = true;
    mapApi?.setOptions([], {});
    return;
  }
  const { list, excluded, cheapest } = visible();
  const priced = list.filter((o) => o.price.known);
  const priciest = priced.length ? Math.max(...priced.map((o) => o.price.total)) : 0;
  const save = cheapest ? priciest - cheapest.price.total : 0;
  $('#resultsCount').innerHTML = list.length
    ? `<b>${list.length} ${list.length === 1 ? 'optie' : 'opties'}</b> · <span class="nw">${duration(state.durationMin)}</span> vanaf <span class="nw">${esc(arrivalLabel(state.results.arrival))}</span>${save >= 0.5 ? ` · <span class="nw">bespaar tot <b>${eur(save)}</b></span>` : ''}`
    : 'Geen opties binnen je filters';

  const recId = state.advice?.recommended_id;
  $('#results').innerHTML = list.length
    ? list.map((o) => cardHtml(o, { cheapest: o.id === cheapest?.id, recommended: recId === o.id && recId !== cheapest?.id })).join('')
    : `<li class="empty"><p>Niets gevonden met deze filters. Verruim de maximale looptijd of prijs, of zet meer soorten parkeren aan.</p></li>`;
  bindCards($('#results'));

  $('#excluded').hidden = !excluded.length;
  if (excluded.length) {
    $('#excludedSummary').textContent = `${excluded.length} ${excluded.length === 1 ? 'optie valt' : 'opties vallen'} af voor ${duration(state.durationMin)} (maximale parkeerduur)`;
    $('#excludedList').innerHTML = excluded.map((o) => cardHtml(o, {})).join('');
    bindCards($('#excludedList'));
  }

  // Prijslabels op de kaart: de eerste 8 uit de lijst + de 5 dichtstbijzijnde.
  const nearest = [...list].filter((o) => !o.shuttle).sort((a, b) => a.walk.minutes - b.walk.minutes).slice(0, 5);
  const fullIds = new Set([...list.slice(0, 8), ...nearest].map((o) => o.id));
  mapApi.setOptions(list, { cheapestId: cheapest?.id, selectedId: state.selectedId, fullIds });
  if (fit) mapApi.fitTo(state.dest, list);
  if (advice) scheduleAdvice(list, cheapest);
}

function cardHtml(o, { cheapest, recommended }) {
  const p = o.price;
  const known = p.known && p.feasible;
  const priceTxt = !p.feasible ? '—' : known ? (p.total === 0 ? 'Gratis' : `${p.estimated ? '≈ ' : ''}${eur(p.total)}`) : '?';
  const per = !p.feasible ? 'niet mogelijk' : known ? (p.total > 0 ? `${eur(p.perHour)}/u gem.` : 'geen kosten') : 'prijs onbekend';
  const badges = [
    cheapest && '<span class="badge badge-cheap">Goedkoopst</span>',
    recommended && `<span class="badge badge-ai">${ICON.spark.replace('<svg', '<svg style="width:10px;height:10px;display:inline;vertical-align:-1px"')} Aanrader</span>`,
    o.live && `<span class="badge badge-live">${o.live.vacant} vrij · live</span>`,
    p.estimated && '<span class="badge badge-warn">Schatting</span>',
    o.warnings?.length && o.source.trust !== 'community' && '<span class="badge badge-warn">Let op</span>',
  ].filter(Boolean);
  const walk = o.shuttle
    ? `<span>${ICON.bus} bus of leenfiets inbegrepen · ${distance(o.walk.straightM)}</span>`
    : `<span>${ICON.walk} ${o.walk.insideZone ? 'in je zone' : `${o.walk.minutes} min · ${distance(o.walk.meters)}`}</span>`;
  const open = state.openId === o.id;
  const cls = ['card', cheapest && 'is-cheapest', state.selectedId === o.id && 'is-selected', open && 'is-open'].filter(Boolean).join(' ');
  return `<li class="${cls}" data-id="${esc(o.id)}">
    <button type="button" class="card-main" aria-expanded="${open}" aria-controls="d-${esc(o.id)}">
      <div class="price-col"><div class="price ${p.total === 0 && known ? 'is-free' : ''} ${!known ? 'is-unknown' : ''}">${priceTxt}</div><div class="per">${per}</div></div>
      <div class="info-col">
        ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
        <h3>${esc(o.name)}</h3>
        <div class="meta"><span>${ICON.car} ${esc(o.kind)}</span>${walk}</div>
      </div>
      ${ICON.chev}
    </button>
    ${open ? detailHtml(o) : ''}
  </li>`;
}

function detailHtml(o) {
  const p = o.price;
  const rows = p.breakdown
    .filter((b) => b.minutes > 0 || b.cost !== 0)
    .map((b) => `<tr><td>${esc(b.label)}${b.minutes ? `<br><span class="min">${duration(b.minutes)}</span>` : ''}</td><td>${b.cost === 0 ? '€ 0,00' : eur(b.cost)}</td></tr>`)
    .join('');
  const priceBlock = !p.feasible
    ? `<p>${esc(p.reason)}</p>`
    : p.known
      ? `<table class="breakdown">${rows}<tr class="total"><td>Totaal voor ${duration(state.durationMin)}${p.estimated ? ' (schatting)' : ''}</td><td>${eur(p.total)}</td></tr></table>${p.assumption ? `<p class="route-info">${esc(p.assumption)}</p>` : ''}`
      : `<p>${esc(p.reason)}</p>`;
  const kv = [
    o.details?.tariff && ['Tarief', o.details.tariff],
    o.details?.paidTimes && ['Betaaltijden', o.details.paidTimes],
    o.address && ['Adres', o.address],
    o.capacity && ['Plaatsen', String(o.capacity)],
    o.live && ['Live', `${o.live.vacant} van ${o.live.capacity} vrij (${timeAgo(o.live.updatedAt)})`],
  ].filter(Boolean);
  const route = state.routes.get(o.id);
  const walkTxt = o.shuttle
    ? `Transferium: neem de bus of een leenfiets naar het centrum. Hemelsbreed ${distance(o.walk.straightM)}.`
    : route?.error
      ? `Geschat: ${o.walk.minutes} min (${distance(o.walk.meters)}). De echte looproute is nu niet beschikbaar.`
      : route
        ? `Looproute: ${route.minutes} min (${distance(route.distance)}) volgens OpenStreetMap.`
        : `Geschat: ${o.walk.minutes} min (${distance(o.walk.meters)}). Looproute laden…`;
  const [trustLabel, trustCls] = TRUST[o.source.trust] ?? ['Bron', 'trust-official'];
  const ll = `${o.lat.toFixed(6)},${o.lon.toFixed(6)}`;
  return `<div class="card-detail" id="d-${esc(o.id)}">
    <div class="detail-section"><h4>Prijsopbouw</h4>${priceBlock}</div>
    ${kv.length ? `<div class="detail-section"><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : ''}
    <div class="detail-section"><h4>Lopen</h4><p class="route-info" data-route="${esc(o.id)}">${esc(walkTxt)}</p></div>
    ${o.notes?.length ? `<div class="detail-section"><ul class="note-list">${o.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    ${o.warnings?.length ? `<ul class="warn-list">${o.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="detail-section src-line"><span class="trust ${trustCls}">${trustLabel}</span> Bron: <a href="${esc(o.source.url)}" target="_blank" rel="noopener">${esc(o.source.label)}</a></div>
    <div class="actions">
      <a class="btn btn-nav" href="https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving" target="_blank" rel="noopener">${ICON.nav} Navigeer</a>
      <a class="btn btn-ghost" href="https://maps.apple.com/?daddr=${ll}&dirflg=d" target="_blank" rel="noopener">Apple Kaarten</a>
      <a class="btn btn-ghost" href="https://waze.com/ul?ll=${ll}&navigate=yes" target="_blank" rel="noopener">Waze</a>
    </div>
  </div>`;
}

function bindCards(root) {
  for (const btn of root.querySelectorAll('.card-main')) {
    btn.addEventListener('click', () => {
      const id = btn.closest('.card').dataset.id;
      const opening = state.openId !== id;
      select(id, { open: opening, toggle: true });
    });
  }
}

function findOption(id) {
  return state.results?.options.find((o) => o.id === id) ?? null;
}

function select(id, { open = true, scroll = false, toggle = false } = {}) {
  const o = findOption(id);
  if (!o) return;
  state.selectedId = id;
  state.openId = toggle ? (open ? id : null) : open ? id : state.openId;
  render({ advice: false });
  mapApi.highlightZone(o.zoneId ?? null);
  if (state.openId === id) {
    mapApi.focus(o, state.dest);
    loadRoute(o);
  }
  if (scroll) document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadRoute(o) {
  if (o.shuttle) return mapApi.showStraight(o, state.dest);
  const cached = state.routes.get(o.id);
  if (cached && !cached.error) return mapApi.showRoute(cached.coordinates, o);
  mapApi.showStraight(o, state.dest);
  try {
    const r = await api.route(o, state.dest);
    state.routes.set(o.id, r);
    if (state.selectedId === o.id) mapApi.showRoute(r.coordinates, o);
  } catch {
    state.routes.set(o.id, { error: true });
  }
  const el = document.querySelector(`[data-route="${CSS.escape(o.id)}"]`);
  if (el) {
    const r = state.routes.get(o.id);
    el.textContent = r.error
      ? `Geschat: ${o.walk.minutes} min (${distance(o.walk.meters)}). De echte looproute is nu niet beschikbaar.`
      : `Looproute: ${r.minutes} min (${distance(r.distance)}) volgens OpenStreetMap.`;
  }
}

// ---------- Advies ----------
function scheduleAdvice(list, cheapest) {
  clearTimeout(adviceTimer);
  const box = $('#advice');
  const priced = list.filter((o) => o.price.known).sort((a, b) => a.price.total - b.price.total || a.walk.minutes - b.walk.minutes);
  if (!priced.length) {
    box.hidden = true;
    return;
  }
  const aiOn = state.status?.ai?.enabled;
  if (aiOn) {
    box.hidden = false;
    box.classList.add('is-loading');
    box.innerHTML = `<div class="advice-top">${ICON.spark}<h3>Advies wordt geschreven</h3></div><p>…………………………………………</p>`;
  }
  adviceTimer = setTimeout(async () => {
    adviceCtl?.abort();
    adviceCtl = new AbortController();
    const payload = {
      destination: state.dest?.label,
      arrival: state.results.arrival,
      duration_label: duration(state.durationMin),
      filters: { max_price_eur: state.filters.maxPrice, max_walk_minutes: state.filters.maxWalk, types: [...state.filters.types] },
      options: priced.slice(0, 8).map((o) => ({
        id: o.id,
        name: o.name,
        kind: o.kind,
        total: o.price.total,
        per_hour: o.price.perHour,
        walk_min: o.walk.minutes,
        walk_m: o.walk.meters,
        shuttle: Boolean(o.shuttle),
        source_trust: o.price.estimated ? 'estimate' : o.source.trust,
        live: o.live ? { vacant: o.live.vacant, capacity: o.live.capacity } : null,
        notes: o.notes,
        warnings: o.warnings,
      })),
    };
    try {
      const a = await api.advice(payload, adviceCtl.signal);
      state.advice = a;
      renderAdvice(a);
      if (a.recommended_id && a.recommended_id !== cheapest?.id) render({ advice: false });
    } catch (err) {
      if (err.name !== 'AbortError') box.hidden = true;
    }
  }, aiOn ? 450 : 150);
}

function renderAdvice(a) {
  const box = $('#advice');
  box.classList.remove('is-loading');
  box.hidden = false;
  const src =
    a.source === 'ai'
      ? 'AI-advies door Claude · prijzen berekend door ParkSmart'
      : a.limited
        ? 'Advies op basis van regels (AI-limiet voor nu bereikt)'
        : 'Advies op basis van regels (AI staat uit)';
  box.innerHTML = `<div class="advice-top">${ICON.spark}<h3>${esc(a.headline)}</h3></div>
    <p>${esc(a.advice)}</p>
    ${a.tip ? `<p class="tip">Tip: ${esc(a.tip)}</p>` : ''}
    <div class="advice-foot"><span class="advice-src">${src}</span>${a.recommended_id ? '<button type="button" class="btn btn-ghost" id="adviceGo">Bekijk</button>' : ''}</div>`;
  $('#adviceGo')?.addEventListener('click', () => select(a.recommended_id, { open: true, scroll: true }));
}

// ---------- Status & meldingen ----------
function showMessage(text, isError = false) {
  const el = $('#empty');
  el.hidden = false;
  el.classList.toggle('is-error', isError);
  el.innerHTML = `<p>${esc(text)}</p>`;
}

function renderAiStatus() {
  const ai = state.status.ai;
  const el = $('#aiStatus');
  el.classList.toggle('is-on', ai.enabled);
  el.textContent = ai.enabled ? `AI: Claude (${ai.model})` : 'AI uit: ingebouwde regels';
  el.title = ai.enabled ? 'Claude zet je zin om in zoekopdrachten en schrijft het advies.' : `${ai.reason}. Zet ANTHROPIC_API_KEY in .env om Claude te gebruiken.`;
  $('#infoAi').textContent = ai.enabled
    ? `AI staat aan (${ai.model}). Claude begrijpt je zoekvraag en schrijft het advies. De prijzen rekent ParkSmart zelf uit; de AI krijgt alleen die berekende feiten.`
    : `AI staat uit (${ai.reason}). Zoeken in gewone taal en het advies werken dan met ingebouwde regels.`;
}

function renderDataLine() {
  const d = state.status.data;
  const label = { rdw: 'RDW-zones', spdp: 'RDW-locaties', osm: 'OpenStreetMap' };
  const pill = (k, v) => {
    if (!v || v.origin === 'none') return `<span class="pill is-warn">${label[k]}: niet geladen</span>`;
    if (v.origin === 'snapshot') return `<span class="pill is-warn">${label[k]}: offline momentopname van ${new Date(v.savedAt).toLocaleDateString('nl-NL')}</span>`;
    return `<span class="pill">${label[k]}: bijgewerkt ${timeAgo(v.savedAt)}</span>`;
  };
  $('#dataLine').innerHTML = `${Object.entries(d).map(([k, v]) => pill(k, v)).join('')}<span class="pill">Garagetarieven: gemeentebesluit 2026</span>`;
}

// ---------- URL-staat (deelbare links) ----------
function updateHash() {
  if (!state.dest) return;
  const p = new URLSearchParams({
    lat: state.dest.lat.toFixed(5),
    lon: state.dest.lon.toFixed(5),
    q: state.dest.label || '',
    d: String(state.durationMin),
  });
  if (state.arrivalMode === 'later' && state.arrival) p.set('a', state.arrival);
  history.replaceState(null, '', `#${p}`);
}

function restoreFromHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const lat = Number(p.get('lat'));
  const lon = Number(p.get('lon'));
  if (p.get('d')) {
    state.durationMin = Math.min(7 * 1440, Math.max(15, Number(p.get('d')) || 120));
    syncDuration();
  }
  if (p.get('a') && p.get('a') >= localIso(nowRounded())) {
    state.arrival = p.get('a');
    setArrivalMode('later', { search: false });
  }
  syncFilters();
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat && lon) setDestination({ lat, lon, label: p.get('q') || 'Bestemming' });
}
