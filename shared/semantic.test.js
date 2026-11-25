// Tests voor de rekenregels van het AI-zoeken (public/js/semantic.js) en hoe de assistent ermee omgaat.
// Zonder het echte model: met kleine, zelfgemaakte vectoren. Het echte model test scripts/eval-bot.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantize, encodeIndex, decodeIndex, scoreAll, interpret, aiQuery, createSemanticEngine, THRESHOLDS } from '../public/js/semantic.js';
import { createSmartAssistant } from '../public/js/smart-assistant.js';

const norm = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

test('vectoren opslaan als int8 en terughalen: gelijkenis blijft vrijwel gelijk', () => {
  const a = norm([0.3, -0.2, 0.9, 0.1]);
  const b = norm([0.25, -0.1, 0.95, 0.05]);
  const meta = { dims: 4, items: [{ k: 'c', cat: 'A', text: 'a' }, { k: 'c', cat: 'B', text: 'b' }] };
  const idx = decodeIndex(meta, encodeIndex([a, b], 4));
  const s = scoreAll(idx, a);
  assert.ok(Math.abs(s[0] - 1) < 0.02, `zelfde vector ≈ 1, kreeg ${s[0]}`);
  const exact = a.reduce((t, x, i) => t + x * b[i], 0);
  assert.ok(Math.abs(s[1] - exact) < 0.02);
  assert.equal(quantize([0, 0]).q.length, 2); // nulvector mag niet crashen
  assert.throws(() => decodeIndex({ dims: 4, items: [{}] }, new ArrayBuffer(3)), /past niet/);
});

// Kleine index: 10 soorten zaken in 10 richtingen, zodat de gap meetbaar is
function tinyIndex() {
  const dims = 12;
  const items = [];
  const vecs = [];
  const unit = (d, extra = 0) => norm(Array.from({ length: dims }, (_, i) => (i === d ? 1 : 0) + (i === 11 ? extra : 0)));
  for (let c = 0; c < 10; c++) {
    items.push({ k: 'c', cat: `Soort${c}`, text: `soort ${c}` });
    vecs.push(unit(c, 0.05));
  }
  items.push({ k: 'p', id: 'p1', cat: 'Soort0', name: 'Zaak een', text: 'zaak een' });
  vecs.push(unit(0, 0.1));
  items.push({ k: 'p', id: 'p2', cat: 'Soort0', name: 'Zaak twee', text: 'zaak twee' });
  vecs.push(unit(0, 0.2));
  items.push({ k: 'p', id: 'p3', cat: 'Soort1', name: 'Enige', text: 'enige' });
  vecs.push(unit(1, 0.1));
  return { idx: decodeIndex({ dims, items }, encodeIndex(vecs, dims)), unit };
}

test('interpret: duidelijke soort zaak, enige zaak van een soort, en onzin', () => {
  const { idx, unit } = tinyIndex();
  const cat = interpret(idx, scoreAll(idx, unit(0)));
  assert.equal(cat.kind, 'category');
  assert.equal(cat.category, 'Soort0');
  assert.equal(cat.count, 2);
  assert.deepEqual(cat.candidates.map((c) => c.id), ['p1', 'p2']); // best passend eerst

  const one = interpret(idx, scoreAll(idx, unit(1)));
  assert.equal(one.kind, 'place'); // soort met maar één zaak: meteen die zaak
  assert.equal(one.place.id, 'p3');

  // Lijkt op alles een beetje: geen duidelijke winnaar, dus "weet ik niet"
  const flat = interpret(idx, scoreAll(idx, norm(Array.from({ length: 12 }, () => 1))));
  assert.equal(flat.kind, 'none');
  assert.ok(flat.score < THRESHOLDS.minTop || flat.gap < THRESHOLDS.minGap);
});

test('aiQuery haalt woorden over tijd, duur en parkeren weg', () => {
  assert.equal(aiQuery('ik moet morgen om 10 uur 2 uur parkeren bij de tandarts'), 'tandarts');
  assert.equal(aiQuery('ik wil een broek kopen'), 'broek kopen');
  assert.equal(aiQuery('auto wassen'), 'auto wassen'); // "auto" telt wel mee
  assert.equal(aiQuery('om 14:00 voor 3 uur'), '');
});

test('motor: laadt pas bij enable, en meldt een fout netjes', async () => {
  let loads = 0;
  const ok = createSemanticEngine({ loadIndex: async () => (loads++, tinyIndex().idx), loadModel: async () => async () => tinyIndex().unit(0) });
  assert.equal(ok.status(), 'off');
  await assert.rejects(() => ok.match('x'), /nog niet geladen/);
  await ok.enable();
  await ok.enable(); // tweede keer niet opnieuw laden
  assert.equal(loads, 1);
  assert.equal(ok.status(), 'ready');
  assert.equal((await ok.match('iets')).kind, 'category');

  const bad = createSemanticEngine({ loadIndex: async () => tinyIndex().idx, loadModel: async () => { throw new Error('geen netwerk'); } });
  await assert.rejects(() => bad.enable(), /geen netwerk/);
  assert.equal(bad.status(), 'error');

  const old = createSemanticEngine({ loadIndex: async () => null, loadModel: async () => null, supported: () => false });
  assert.equal(old.status(), 'unsupported');
});

// De assistent met nep-onderdelen: snappen de regels het niet, dan biedt hij AI aan (zonder iets te downloaden)
function assistant(semantic) {
  const state = { dest: null, durationMin: 120, arrivalMode: 'now', arrival: null, filters: { maxWalk: 20, types: new Set() } };
  const api = {
    aiParse: async () => ({ destination: 'kiespijn', destination_guess: false, place: null, placeInCity: null, date: null, time: null, duration_minutes: null, types: null, max_price_eur: null, max_walk_minutes: null, topic: null }),
    geocode: async () => ({ result: null }),
  };
  return createSmartAssistant({ api, state, applySearch: async () => ({ ok: false, message: 'x' }), searchSummary: () => null, findOption: () => null, toDest: (r) => r, localIso: (d) => d.toISOString(), nowRounded: () => new Date(), navUrl: () => '#', semantic });
}

test('assistent: zonder AI gewoon "niet gevonden", met AI eerst toestemming vragen', async () => {
  const none = await assistant(null).turn('ik heb kiespijn');
  assert.equal(none.intent, 'notfound');

  const off = { status: () => 'off', consented: () => false, enable: async () => assert.fail('niet zonder toestemming laden'), match: async () => assert.fail() };
  const offer = await assistant(off).turn('ik heb kiespijn');
  assert.equal(offer.intent, 'ai_offer');
  assert.ok(offer.actions.some((a) => a.aiLoad && a.ask === 'ik heb kiespijn'));
  assert.match(offer.text, /in je browser/);

  const unsupported = await assistant(off).turn('waar is een laadpaal');
  assert.equal(unsupported.intent, 'unsupported');
});
