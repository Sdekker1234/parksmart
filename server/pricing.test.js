// Tests voor de tariefregels. Draai met `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceGarage, priceTransferium, priceZone, priceSpdp, parseArrival } from './pricing.js';
import { DECREE_GARAGES, decreeFor, garageWithTariff } from './config.js';
import { parseRules } from './rules.js';

const g = (id) => garageWithTariff(DECREE_GARAGES.find((x) => x.areaId === id), decreeFor('20261118'));

test('besluitjaar: 2026 officieel, 2027 (nog niet gepubliceerd) als schatting', () => {
  assert.equal(decreeFor('20261118').estimated, false);
  const d = decreeFor('20270115');
  assert.equal(d.year, 2026);
  assert.equal(d.estimated, true);
});
const ctx = { specialDays: new Map([['20261225', '1E KERSTDAG']]), fareParts: () => FARES };

// Tariefdelen zoals in RDW (2026): B = €3,71/u per minuut, D = eerste 2 uur gratis.
const FARES = new Map([
  ['TAR_B', [{ from: 0, to: 999999, amount: 3.71 / 60, step: 1 }]],
  ['TAR_D', [{ from: 0, to: 120, amount: 0, step: 1 }, { from: 120, to: 999999, amount: 3.71 / 60, step: 1 }]],
]);
const days = ['MAANDAG', 'DINSDAG', 'WOENSDAG', 'DONDERDAG', 'VRIJDAG', 'ZATERDAG'];
const zone = (code, maxMin = 0) => ({
  timeframes: [
    ...days.map((day) => ({ day, start: 540, end: 1440, fareCode: code, maxMin })),
    { day: 'ZONDAG', start: 720, end: 1440, fareCode: code, maxMin },
    { day: '1E KERSTDAG', start: 720, end: 1440, fareCode: code, maxMin },
  ],
});

test('garage overdag: 2 uur Paleiskwartier = 2 × €3,41', () => {
  const r = priceGarage(g('796_PAL'), parseArrival('2026-11-18T10:00'), 120, ctx);
  assert.equal(r.total, 6.82);
});

test('garage avond: zaterdag 18:00 + 10 uur valt onder avondmaximum €7,50', () => {
  const r = priceGarage(g('796_WOLV'), parseArrival('2026-11-21T18:00'), 600, ctx);
  assert.equal(r.total, 7.5);
});

test('garage koopavond: donderdag 19:00-21:00 is nog dagtarief', () => {
  const r = priceGarage(g('796_STJAN'), parseArrival('2026-11-19T19:00'), 120, ctx);
  assert.equal(r.total, 6.82);
});

test('garage dagmaximum: 48 uur = 2 × €20', () => {
  const r = priceGarage(g('796_WOLV'), parseArrival('2026-11-18T22:00'), 2880, ctx);
  assert.equal(r.total, 40);
});

test('Sint Josephstraat: zondag 07:00-14:00 gratis', () => {
  const r = priceGarage(g('796_JOSE'), parseArrival('2026-11-22T10:00'), 180, ctx);
  assert.equal(r.total, 0);
});

test('transferium: €5 per (begonnen) dag', () => {
  assert.equal(priceTransferium({ perDay: 5 }, 180).total, 5);
  assert.equal(priceTransferium({ perDay: 5 }, 1500).total, 10);
});

test('straat: betaald vanaf 09:00, daarvoor gratis', () => {
  const r = priceZone(zone('TAR_B'), parseArrival('2026-11-18T08:00'), 120, ctx);
  assert.equal(r.total, 3.71);
});

test('straat: eerste 2 uur gratis (tarief D)', () => {
  const r = priceZone(zone('TAR_D'), parseArrival('2026-11-18T10:00'), 180, ctx);
  assert.equal(r.total, 3.71);
});

test('straat: Eerste Kerstdag pas betaald vanaf 12:00', () => {
  const r = priceZone(zone('TAR_B'), parseArrival('2026-12-25T10:00'), 120, ctx);
  assert.equal(r.total, 0);
});

test('straat: maximale parkeerduur maakt optie ongeschikt', () => {
  const r = priceZone(zone('TAR_B', 60), parseArrival('2026-11-18T10:00'), 90, ctx);
  assert.equal(r.feasible, false);
});

test('SPDP: per begonnen uur met dagmaximum', () => {
  const day = (d) => ({
    tariffDescription: 'test',
    validityDays: [d],
    validityFromTime: { h: 0, m: 0 },
    validityUntilTime: { h: 23, m: 59 },
    intervalRates: [
      { charge: 2.73, chargePeriod: 60, durationType: 'Minutes', durationFrom: 0, durationUntil: -1 },
      { charge: 15.47, chargePeriod: 1440, durationType: 'Minutes', durationFrom: 0, durationUntil: -1 },
    ],
  });
  const fac = { tariffs: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day) };
  assert.equal(priceSpdp(fac, parseArrival('2026-11-18T10:00'), 90).total, 5.46);
  assert.equal(priceSpdp(fac, parseArrival('2026-11-18T10:00'), 600).total, 15.47);
});

test('regelparser: zin met dag, tijd, duur en loopafstand', () => {
  const r = parseRules('zaterdag om half drie drie uur bij de Sint-Jan, max 10 minuten lopen', new Date(Date.UTC(2026, 10, 18, 14, 39)));
  assert.equal(r.date, '2026-11-21');
  assert.equal(r.time, '14:30');
  assert.equal(r.duration_minutes, 180);
  assert.equal(r.max_walk_minutes, 10);
  assert.match(r.destination, /sint-jan/i);
});
