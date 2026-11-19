// Offline tests voor de Nederlandstalige parser (server/rules.js), gebaseerd op fouten uit de bot-evaluatie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRules } from '../server/rules.js';

const NOW = new Date(Date.UTC(2026, 10, 19, 13, 0)); // donderdag 19-11-2026 13:00 (NL-wandklok)
const p = (s) => parseRules(s, NOW);

test('tijden: kwart over/voor, half, morgenochtend', () => {
  assert.equal(p('om kwart over 2 naar de markt').time, '14:15');
  assert.equal(p('om kwart voor 10 naar de markt').time, '09:45');
  assert.equal(p('ik ben er om half 3').time, '14:30');
  const m = p('morgenochtend om 9 uur naar het provinciehuis');
  assert.equal(m.date, '2026-11-20');
  assert.equal(m.time, '09:00');
});

test('datums: volgende week, weekdag', () => {
  assert.equal(p('volgende week zaterdag bij de hema').date, '2026-11-28');
  assert.equal(p('zaterdag bij de hema').date, '2026-11-21');
});

test('duur: tot middernacht, paar uur, en "kwartier" niet in een naam', () => {
  const r = p('van 20:00 tot middernacht naar de parade');
  assert.equal(r.duration_minutes, 240);
  assert.equal(r.until, '24:00');
  assert.equal(p('een paar uurtjes bij de markt').duration_minutes, 120);
  const pk = p('Wat kost 2 uur parkeren in Paleiskwartier?');
  assert.equal(pk.duration_minutes, 120);
  assert.match(pk.destination, /paleiskwartier/i);
});

test('prijs: "5 euro of minder" en "onder de 10 euro"', () => {
  assert.equal(p('voor 5 euro of minder bij de hema').max_price_eur, 5);
  assert.equal(p('onder de 10 euro bij het station').max_price_eur, 10);
});

test('bestemming: stopwoorden, afkortingen, andere stad', () => {
  assert.equal(p('Ik moet om 11 uur bij de tandarts zijn, waar kan ik parkeren?').destination, 'Tandarts');
  assert.match(p('ah vughterstraat').destination, /albert heijn/i);
  assert.match(p('ik zoek een parkeerplek bij de bieb').destination, /bibliotheek/i);
  assert.equal(p('parkeren in eindhoven').outside_city, 'Eindhoven');
});

test('vervolgvragen geven geen nep-bestemming', () => {
  assert.equal(p('liever een garage').destination, null);
  assert.equal(p('is er ook iets gratis?').destination, null);
  assert.deepEqual(p('is er ook iets gratis?').types, ['free']);
});
