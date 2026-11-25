// Tests voor "hoe actueel zijn de tarieven" en wat de assistent dan zegt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratesFreshness, STALE_AFTER_MS } from '../public/js/summary.js';
import { createSmartAssistant } from '../public/js/smart-assistant.js';

const NOW = Date.UTC(2026, 10, 25, 12, 0);

test('ratesFreshness: vers, verouderd, en mislukte laatste controle', () => {
  assert.equal(ratesFreshness(null), null);
  const fresh = ratesFreshness({ data: { rdw: { savedAt: NOW - 3600e3 } } }, NOW);
  assert.equal(fresh.stale, false);
  const old = ratesFreshness({ data: { rdw: { savedAt: NOW - STALE_AFTER_MS - 1 } }, refresh: { checkedAt: NOW, sources: { rdw: { ok: false } } } }, NOW);
  assert.equal(old.stale, true);
  assert.equal(old.lastCheckFailed, true);
  assert.match(old.dateLabel, /november/);
});

test('assistent zegt erbij als hij niet zeker weet of de tarieven nog kloppen', async () => {
  const option = { id: 'zone:1', name: 'Zone Test', kind: 'Straat', total_eur: 3, walk_minutes: 4, source_trust: 'official' };
  const sum = { destination: { label: 'Markt' }, arrival: '2026-11-25T12:00', duration_minutes: 120, duration_label: '2 uur', filters: { types: ['garage', 'street', 'pr', 'free'], max_walk_minutes: 20, max_price_eur: null }, options: [option] };
  const state = { dest: null, durationMin: 120, arrivalMode: 'now', arrival: null, filters: { maxWalk: 20, types: new Set() }, results: null };
  const make = (stale) =>
    createSmartAssistant({
      api: {
        aiParse: async () => ({ destination: 'markt', destination_guess: false, place: { id: 'lm-markt', label: 'Markt', lat: 51.69, lon: 5.3 }, placeInCity: true, date: null, time: null, duration_minutes: 120, types: null, max_price_eur: null, max_walk_minutes: null, topic: null }),
        geocode: async () => ({ result: null }),
      },
      state,
      applySearch: async () => ({ ok: true }),
      searchSummary: () => sum,
      findOption: () => null,
      toDest: (r) => r,
      localIso: (d) => d.toISOString(),
      nowRounded: () => new Date(NOW),
      navUrl: () => '#',
      freshness: () => (stale ? { stale: true, dateLabel: '18 november' } : { stale: false }),
    });
  const ok = await make(false).turn('2 uur bij de markt');
  assert.doesNotMatch(ok.text, /weet ik niet zeker/);
  const warn = await make(true).turn('2 uur bij de markt');
  assert.match(warn.text, /bijgewerkt op 18 november\. Of ze nog kloppen, weet ik niet zeker/);
});
