// Tariefberekening. Tijden zijn "wandklok"-tijden in Nederland: we stoppen de lokale tijd
// in een UTC-Date, zodat dag/uur-logica niet afhangt van de tijdzone van de server.
import { GARAGE_EVENING } from './config.js';

const DAY_NL = ['ZONDAG', 'MAANDAG', 'DINSDAG', 'WOENSDAG', 'DONDERDAG', 'VRIJDAG', 'ZATERDAG'];
const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
export const eur = (x) => `€${round2(x).toFixed(2).replace('.', ',')}`;
export const fmtMin = (m) =>
  m >= 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// "2026-11-18T14:30" -> Date (wandklok als UTC)
export function parseArrival(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const ymdOf = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const modOf = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();
const at = (arrival, i) => new Date(arrival.getTime() + i * 60000);

class Breakdown {
  constructor() {
    this.items = new Map();
  }
  add(key, label, minutes, cost) {
    const it = this.items.get(key) ?? { label, minutes: 0, cost: 0 };
    it.minutes += minutes;
    it.cost += cost;
    this.items.set(key, it);
  }
  list() {
    return [...this.items.values()].map((i) => ({ label: i.label, minutes: i.minutes, cost: round2(i.cost) }));
  }
}

const result = (total, bd, extra = {}) => ({ known: true, feasible: true, total: round2(total), breakdown: bd.list(), ...extra });
const infeasible = (reason) => ({ known: true, feasible: false, total: null, reason, breakdown: [] });
export const unknownPrice = (reason) => ({ known: false, feasible: true, total: null, reason, breakdown: [] });

// ---------- Straatparkeren (RDW NPR-zones) ----------
// ctx = { specialDays: Map<ymd,naam>, fareParts: (ymd) => Map<code, parts[]> }
export function priceZone(zone, arrival, durationMin, ctx) {
  const bd = new Breakdown();
  let total = 0;
  let paidIdx = 0; // aantal betaalde minuten in deze sessie (voor "eerste 2 uur gratis")
  let contig = 0;
  let contigKey = null;
  const dayTfs = new Map();
  for (let i = 0; i < durationMin; i++) {
    const t = at(arrival, i);
    const ymd = ymdOf(t);
    const mod = modOf(t);
    let tfs = dayTfs.get(ymd);
    if (!tfs) {
      const special = ctx.specialDays.get(ymd);
      const sp = special ? zone.timeframes.filter((x) => x.day === special) : [];
      tfs = sp.length ? sp : zone.timeframes.filter((x) => x.day === DAY_NL[t.getUTCDay()]);
      dayTfs.set(ymd, tfs);
    }
    const tf = tfs.find((x) => mod >= x.start && mod < x.end);
    if (!tf || !tf.fareCode || tf.fareCode === 'TAR_0') {
      bd.add('free', 'Gratis (buiten de betaaltijden)', 1, 0);
      contig = 0;
      contigKey = null;
      continue;
    }
    if (tf.maxMin > 0) {
      const key = `${ymd}:${tf.start}`;
      contig = key === contigKey ? contig + 1 : 1;
      contigKey = key;
      if (contig > tf.maxMin) {
        return infeasible(`Maximaal ${tf.maxMin} min parkeren tussen ${fmtMin(tf.start)} en ${fmtMin(tf.end)}.`);
      }
    } else {
      contig = 0;
      contigKey = null;
    }
    const parts = ctx.fareParts(ymd).get(tf.fareCode) ?? [];
    const part = parts.find((p) => paidIdx >= p.from && paidIdx < p.to);
    let cost = 0;
    if (part && part.amount > 0 && (paidIdx - part.from) % part.step === 0) cost = part.amount;
    total += cost;
    if (!part || part.amount === 0) {
      bd.add('freepart', part ? `Gratis deel (eerste ${part.to} min)` : 'Gratis', 1, 0);
    } else {
      const perHour = (part.amount / part.step) * 60;
      bd.add(`paid:${perHour.toFixed(4)}`, `Betaald · ${eur(perHour)}/u (per minuut)`, 1, cost);
    }
    paidIdx++;
  }
  return result(total, bd);
}

// ---------- Gemeentelijke garages (besluit 2026) ----------
export function priceGarage(g, arrival, durationMin, ctx) {
  const ev = GARAGE_EVENING;
  const bd = new Breakdown();
  let total = 0;
  let blockCost = 0;
  let segCost = 0;
  let inSeg = false;
  let capSavings = 0;
  const closeSeg = () => {
    if (!inSeg) return;
    const capped = Math.min(segCost, g.eveningMax);
    capSavings += segCost - capped;
    blockCost += capped;
    segCost = 0;
    inSeg = false;
  };
  const closeBlock = () => {
    closeSeg();
    if (blockCost > g.dayMax) {
      capSavings += blockCost - g.dayMax;
      blockCost = g.dayMax;
    }
    total += blockCost;
    blockCost = 0;
  };
  for (let i = 0; i < durationMin; i++) {
    if (i > 0 && i % 1440 === 0) closeBlock();
    const t = at(arrival, i);
    const mod = modOf(t);
    const dow = t.getUTCDay();
    const special = ctx.specialDays.get(ymdOf(t));
    if (g.sundayFree && dow === 0 && mod >= g.sundayFree.from && mod < g.sundayFree.to) {
      closeSeg();
      bd.add('free', `Gratis (zondag ${fmtMin(g.sundayFree.from)}–${fmtMin(g.sundayFree.to)})`, 1, 0);
      continue;
    }
    const morningRegime = dow === 0 || ev.holidays.includes(special);
    const eveningStart = dow === 4 ? ev.koopavondFrom : ev.eveningFrom;
    const evening =
      mod < ev.nightUntil ||
      mod >= eveningStart ||
      (morningRegime && mod >= ev.sundayMorning.from && mod < ev.sundayMorning.to);
    if (evening) {
      inSeg = true;
      segCost += g.eveningRate / 60;
      bd.add('evening', `Avond/nacht · ${eur(g.eveningRate)}/u (max ${eur(g.eveningMax)} per avond)`, 1, g.eveningRate / 60);
    } else {
      closeSeg();
      blockCost += g.dayRate / 60;
      bd.add('day', `Dagtarief · ${eur(g.dayRate)}/u`, 1, g.dayRate / 60);
    }
  }
  closeBlock();
  if (capSavings > 0.004) bd.add('cap', `Maximum toegepast (dag ${eur(g.dayMax)} / avond ${eur(g.eveningMax)})`, 0, -capSavings);
  return result(total, bd, { assumption: 'Afrekening per minuut aangenomen; het besluit noemt een tarief "per 60 minuten".' });
}

// ---------- Transferia (besluit 2026) ----------
export function priceTransferium(t, durationMin) {
  const days = Math.max(1, Math.ceil(durationMin / 1440));
  const bd = new Breakdown();
  bd.add('day', `${days} × dagtarief ${eur(t.perDay)} (incl. bus of leenfiets, max. 4 pers.)`, durationMin, days * t.perDay);
  return result(days * t.perDay, bd);
}

// ---------- Generieke SPDP-tarieven (exploitant via RDW) ----------
const isValid = (start, end, t) => (!start || start <= t) && (!end || end > t);

export function priceSpdp(fac, arrival, durationMin) {
  // Wandklok-tijd als epoch is hooguit een uur verschoven; ruim voldoende voor geldigheidsdata.
  const tSec = arrival.getTime() / 1000;
  const day = DAY_EN[arrival.getUTCDay()];
  const mod = modOf(arrival);
  const tariffs = (fac.tariffs ?? []).filter((t) => {
    if (!isValid(t.startOfPeriod, t.endOfPeriod, tSec)) return false;
    if (!(t.validityDays ?? []).includes(day)) return false;
    const from = (t.validityFromTime?.h ?? 0) * 60 + (t.validityFromTime?.m ?? 0);
    const until = (t.validityUntilTime?.h ?? 23) * 60 + (t.validityUntilTime?.m ?? 59);
    return mod >= from && mod <= until;
  });
  if (!tariffs.length) return unknownPrice('Geen geldig tarief bekend in RDW-data voor dit tijdstip.');
  const unit = (r) => (r.durationType === 'Hours' ? 60 : r.durationType === 'Days' ? 1440 : 1);
  const rates = [];
  const caps = [];
  for (const t of tariffs) {
    for (const r of t.intervalRates ?? []) {
      if (!isValid(r.validityStartOfPeriod, r.validityEndOfPeriod, tSec)) continue;
      const u = unit(r);
      const seg = {
        from: (r.durationFrom ?? 0) * u,
        to: r.durationUntil == null || r.durationUntil < 0 ? Infinity : r.durationUntil * u,
        charge: Number(r.charge) || 0,
        per: Math.max(1, (Number(r.chargePeriod) || 1) * u),
      };
      if (seg.per >= 1440 && seg.from === 0 && seg.to === Infinity) caps.push(seg.charge);
      else rates.push(seg);
    }
    const m = /dagkaart\s*(?:€\s*)?(\d+[,.]\d+)/i.exec(t.tariffDescription ?? '');
    if (m) caps.push(parseFloat(m[1].replace(',', '.')));
  }
  if (!rates.length && !caps.length) return unknownPrice('Tariefstructuur in RDW-data niet bruikbaar.');
  const cap = caps.length ? Math.min(...caps) : null;
  const bd = new Breakdown();
  const f = (minutes, record) =>
    rates.reduce((sum, r) => {
      const ov = Math.max(0, Math.min(minutes, r.to) - r.from);
      if (ov <= 0) return sum;
      const c = Math.ceil(ov / r.per) * r.charge;
      if (record) {
        const label = r.charge === 0 ? `Gratis (${r.from}–${r.to === Infinity ? '…' : r.to} min)` : `${eur(r.charge)} per ${r.per} min`;
        bd.add(`r:${r.from}:${r.per}:${r.charge}`, label, ov, c);
      }
      return sum + c;
    }, 0);
  let total;
  if (!rates.length) {
    total = Math.ceil(durationMin / 1440) * cap;
    bd.add('cap', `Dagtarief ${eur(cap)}`, durationMin, total);
  } else {
    const uncapped = f(durationMin, true);
    const full = Math.floor(durationMin / 1440);
    const rem = durationMin % 1440;
    const dayCost = cap != null ? Math.min(cap, f(1440)) : f(1440);
    const remCost = rem > 0 ? (cap != null ? Math.min(cap, f(rem)) : f(rem)) : 0;
    total = full * dayCost + remCost;
    if (uncapped - total > 0.004) bd.add('capped', `Dagmaximum ${eur(cap)} toegepast`, 0, total - uncapped);
  }
  return result(total, bd, {
    tariffNames: [...new Set(tariffs.map((t) => t.tariffDescription).filter(Boolean))],
  });
}

// Inrijtijden uit SPDP voor de aankomstdag (alleen ter waarschuwing).
export function entryWarning(openingTimes, arrival) {
  const day = DAY_EN[arrival.getUTCDay()];
  const mod = modOf(arrival);
  const entries = (openingTimes ?? []).flatMap((o) => o.entryTimes ?? []).filter((e) => (e.dayNames ?? []).includes(day));
  if (!entries.length) return null;
  const ok = entries.some((e) => {
    const from = (e.enterFrom?.h ?? 0) * 60 + (e.enterFrom?.m ?? 0);
    const until = (e.enterUntil?.h ?? 23) * 60 + (e.enterUntil?.m ?? 59);
    return mod >= from && mod <= until;
  });
  if (ok) return null;
  const e = entries[0];
  const f = `${String(e.enterFrom?.h ?? 0).padStart(2, '0')}:${String(e.enterFrom?.m ?? 0).padStart(2, '0')}`;
  const u = `${String(e.enterUntil?.h ?? 23).padStart(2, '0')}:${String(e.enterUntil?.m ?? 59).padStart(2, '0')}`;
  return `Volgens RDW-gegevens kun je op deze dag inrijden tussen ${f} en ${u}. Controleer de actuele openingstijden.`;
}
