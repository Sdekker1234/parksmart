// Tests voor het zoeken op bedrijven (gebruikt de meegeleverde momentopname, geen netwerk).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaces, searchPlaces, hoursNl, branchesOf, placesStatus } from './places.js';

before(async () => {
  await loadPlaces({ fast: true });
});

test('momentopname bevat honderden bedrijven', () => {
  assert.ok(placesStatus().count > 1000);
});

test('zoeken op merk: HEMA, centrum eerst', () => {
  const [first] = searchPlaces('HEMA');
  assert.equal(first.name, 'HEMA');
  assert.equal(first.street, 'Pensmarkt');
  assert.ok(branchesOf(first).length >= 2);
});

test('merk + straat kiest de juiste vestiging', () => {
  const [first] = searchPlaces('albert heijn vughterstraat');
  assert.equal(first.street, 'Vughterstraat');
});

test('apostrof maakt niet uit (McDonalds)', () => {
  assert.match(searchPlaces('McDonalds')[0].name, /McDonald/);
});

test('alleen een straatnaam is geen bedrijf', () => {
  assert.equal(searchPlaces('Vughterstraat').length, 0);
});

test('openingstijden in het Nederlands', () => {
  assert.equal(hoursNl('Mo-Sa 09:00-18:00; Su 12:00-17:00'), 'ma–za 09:00–18:00 · zo 12:00–17:00');
  assert.equal(hoursNl('Mo-We,Fr off'), 'ma–wo, vr gesloten');
});
