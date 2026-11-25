// RDW Open Data Parkeren (Nationaal Parkeer Register) voor één gemeente.
// Bron: https://opendata.rdw.nl (Socrata). Bevat betaalzones, regelingen, tijdvakken en tarieven.
import { CITY, TTL } from './config.js';
import { fetchJson, loadWithFallback } from './cache.js';
import { parseWKT } from './geo.js';

const BASE = 'https://opendata.rdw.nl/resource';
const DATASETS = {
  gebied: 'adw6-9hsg', // GEBIED
  geometrie: 'nsk3-v9n7', // GEOMETRIE GEBIED (WKT, WGS84)
  gebiedRegeling: 'qtex-qwd8', // GEBIED REGELING
  regeling: 'yefi-qfiq', // REGELING
  tijdvak: 'ixf8-gtwq', // TIJDVAK
  tariefdeel: '534e-5vdg', // TARIEFDEEL
  tariefberekening: 'nfzq-8g7y', // TARIEFBEREKENING
  specialeDag: 'hpi4-mynq', // SPECIALE DAG
  parkeergebied: 'mz4f-59fw', // PARKEERGEBIED (koppeling naar SPDP-UUID)
  specificaties: 'b3us-f26s', // SPECIFICATIES PARKEERGEBIED (capaciteit)
};

// Eén dataset ophalen, met maximaal drie pogingen: vanaf GitHub Actions valt de verbinding met
// opendata.rdw.nl af en toe weg ("fetch failed").
async function fetchDataset(name, id) {
  const url = `${BASE}/${id}.json?areamanagerid=${CITY.areaManagerId}&$limit=50000`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = await fetchJson(url, { timeoutMs: 45000 });
      if (!Array.isArray(rows)) throw new Error(`Onverwachte respons voor ${name}`);
      return rows;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 4000));
    }
  }
  throw lastErr;
}

async function fetchAll() {
  const out = {};
  // Na elkaar in plaats van allemaal tegelijk: minder kans dat RDW verbindingen afbreekt
  for (const [name, id] of Object.entries(DATASETS)) out[name] = await fetchDataset(name, id);
  if (!out.tariefdeel.length || !out.geometrie.length) throw new Error('RDW-data onvolledig');
  return out;
}

let state = null; // { raw, origin, savedAt }
const modelCache = new Map(); // ymd -> model

export async function loadRdw(opts = {}) {
  const res = await loadWithFallback('rdw', TTL.rdw, fetchAll, opts);
  state = res;
  modelCache.clear();
  return res;
}

export function rdwStatus() {
  if (!state) return { origin: 'none' };
  return { origin: state.origin, savedAt: state.savedAt, error: state.error };
}

export function rdwRaw() {
  return state?.raw ?? state?.data;
}

// RDW-datums: "20260101", "20201202140818" of "2022-03-11T00:00:00.000" -> "YYYYMMDD"
const d8 = (s) => (s ? String(s).replace(/[^0-9]/g, '').slice(0, 8) : '');
const validOn = (start, end, ymd) => (!start || d8(start) <= ymd) && (!end || d8(end) >= ymd);
// "900" -> 540 minuten; "2400" -> 1440
const hhmm = (v) => {
  const n = parseInt(v, 10) || 0;
  return Math.floor(n / 100) * 60 + (n % 100);
};

export function specialDays() {
  const raw = rdwRaw();
  const map = new Map();
  for (const r of raw?.specialeDag ?? []) map.set(d8(r.datespecialday), r.namespecialday);
  return map;
}

// UUID (SPDP) per RDW-gebied, bv. 796_WOLV -> 461a6ae3-...
export function uuidByArea() {
  const raw = rdwRaw();
  return new Map((raw?.parkeergebied ?? []).filter((r) => r.uuid).map((r) => [r.areaid, r.uuid]));
}

export function capacityByArea() {
  const raw = rdwRaw();
  return new Map((raw?.specificaties ?? []).map((r) => [r.areaid, Number(r.capacity) || null]));
}

// Tariefdelen die op een datum gelden, per tariefcode, gesorteerd op duur.
function farePartsOn(raw, ymd) {
  const byCode = new Map();
  for (const r of raw.tariefdeel) {
    if (!validOn(r.startdatefarepart, r.enddatefarepart, ymd)) continue;
    const part = {
      from: Number(r.startdurationfarepart) || 0,
      to: Number(r.enddurationfarepart) || 999999,
      amount: Number(r.amountfarepart) || 0, // bedrag per stap
      step: Math.max(1, Number(r.stepsizefarepart) || 1), // stapgrootte in minuten
    };
    if (!byCode.has(r.farecalculationcode)) byCode.set(r.farecalculationcode, []);
    byCode.get(r.farecalculationcode).push(part);
  }
  for (const parts of byCode.values()) parts.sort((a, b) => a.from - b.from);
  return byCode;
}

// Bouw het zonemodel (alleen betaald/gratis straatparkeren met geometrie) voor een datum.
export function zoneModel(ymd) {
  if (modelCache.has(ymd)) return modelCache.get(ymd);
  const raw = rdwRaw();
  if (!raw) return null;
  const fareParts = farePartsOn(raw, ymd);
  const fareDesc = new Map(
    raw.tariefberekening
      .filter((r) => validOn(r.startdatefare, r.enddatefare, ymd))
      .map((r) => [r.farecalculationcode, r.farecalculationdesc]),
  );
  const regDesc = new Map(
    raw.regeling
      .filter((r) => validOn(r.startdateregulation, r.enddateregulation, ymd))
      .map((r) => [r.regulationid, r.regulationdesc]),
  );
  const timeframes = new Map(); // regulationId -> [{day,start,end,fareCode,maxMin}]
  for (const t of raw.tijdvak) {
    if (!validOn(t.startdatetimeframe, t.enddatetimeframe, ymd)) continue;
    if (!timeframes.has(t.regulationid)) timeframes.set(t.regulationid, []);
    timeframes.get(t.regulationid).push({
      day: t.daytimeframe,
      start: hhmm(t.starttimetimeframe),
      end: hhmm(t.endtimetimeframe),
      fareCode: t.farecalculationcode || null,
      maxMin: Number(t.maxdurationright) || 0,
    });
  }
  const geomByArea = new Map();
  for (const g of raw.geometrie) {
    if (!validOn(g.startdatearea, g.enddatearea, ymd)) continue;
    const polys = parseWKT(g.areageometryastext);
    if (!polys.length) continue;
    if (!geomByArea.has(g.areaid)) geomByArea.set(g.areaid, []);
    geomByArea.get(g.areaid).push(...polys);
  }
  const areaName = new Map(
    raw.gebied.filter((a) => validOn(a.startdatearea, a.enddatearea, ymd)).map((a) => [a.areaid, a.areadesc]),
  );

  const zones = [];
  for (const gr of raw.gebiedRegeling) {
    if (!validOn(gr.startdatearearegulation, gr.enddatearearegulation, ymd)) continue;
    if (gr.usageid !== 'BETAALDP') continue; // alleen betaald parkeren voor bezoekers
    if (zones.some((z) => z.id === gr.areaid)) continue;
    const polygons = geomByArea.get(gr.areaid);
    const name = areaName.get(gr.areaid);
    const tfs = timeframes.get(gr.regulationid);
    if (!polygons || !name || !tfs?.length) continue;
    const paidCodes = [...new Set(tfs.map((t) => t.fareCode).filter((c) => c && fareParts.has(c)))];
    if (!paidCodes.length) continue;
    const mainCode = paidCodes.find((c) => c !== 'TAR_0') ?? paidCodes[0];
    const parts = fareParts.get(mainCode) ?? [];
    const paidPart = parts.find((p) => p.amount > 0);
    zones.push({
      id: gr.areaid,
      name: cleanZoneName(name),
      rawName: name,
      regulationId: gr.regulationid,
      regulationDesc: regDesc.get(gr.regulationid) ?? '',
      fareCode: mainCode,
      fareDesc: fareDesc.get(mainCode) ?? mainCode,
      perHour: paidPart ? round2((paidPart.amount / paidPart.step) * 60) : 0,
      freeFirstMin: parts[0] && parts[0].amount === 0 && parts[0].to < 999999 ? parts[0].to : 0,
      timeframes: tfs,
      polygons,
    });
  }
  const model = { ymd, zones, fareParts, fareDesc };
  modelCache.set(ymd, model);
  return model;
}

function cleanZoneName(n) {
  return n
    .replace(/^Betaald [Pp]arkeren\s*/, '')
    .replace(/\bt Zand\b/, "'t Zand")
    .replace(/Kop van t Zand/, "Kop van 't Zand")
    .trim();
}

export const round2 = (x) => Math.round(x * 100) / 100;
