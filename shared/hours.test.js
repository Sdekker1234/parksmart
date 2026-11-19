// Tests voor het lezen van openingstijden (public/js/hours.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpeningHours, describeDay, checkVisit } from '../public/js/hours.js';

const HEMA = 'Mo-We,Fr-Sa 09:00-18:00; Th 09:00-21:00; Su 12:00-17:30';

test('dagbereiken, lijsten en losse dagen', () => {
  const w = parseOpeningHours(HEMA);
  assert.equal(describeDay(w, 1), '09:00–18:00'); // ma
  assert.equal(describeDay(w, 4), '09:00–21:00'); // do
  assert.equal(describeDay(w, 0), '12:00–17:30'); // zo
});

test('24/7, gesloten dagen en onbekende notatie', () => {
  assert.equal(describeDay(parseOpeningHours('24/7'), 3), '00:00–24:00');
  assert.equal(describeDay(parseOpeningHours('Mo off; Tu-Sa 10:00-17:00; PH off'), 1), 'gesloten');
  assert.equal(parseOpeningHours('Jan-Mar Mo-Fr 09:00-17:00'), null);
});

test('bezoek: open, sluit tijdens bezoek, gaat later open, dicht', () => {
  assert.equal(checkVisit(HEMA, new Date(2026, 10, 21, 10, 0), 120).status, 'open'); // za 10:00
  assert.equal(checkVisit(HEMA, new Date(2026, 10, 21, 17, 0), 120).status, 'closes_during');
  assert.equal(checkVisit(HEMA, new Date(2026, 10, 22, 10, 0), 60).status, 'opens_later'); // zo 10:00
  assert.equal(checkVisit('Mo-Fr 09:00-17:00', new Date(2026, 10, 21, 12, 0), 60).status, 'closed'); // za
});
