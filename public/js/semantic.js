// Slim zoeken met AI, zonder account of sleutel.
// Een klein meertalig taalmodel (paraphrase-multilingual-MiniLM-L12-v2) zet een vraag om in een
// betekenisvector en vergelijkt die met vectoren die we vooraf hebben berekend voor onze eigen bronnen:
// de bedrijven uit OpenStreetMap, de soorten zaken (met gewone woorden erbij, zoals "kiespijn" bij
// tandarts) en bekende plekken. Het antwoord komt dus altijd uit onze eigen lijst. Lijkt niets er
// genoeg op, dan zegt de assistent dat hij het niet weet.
// Dit bestand bevat alleen de rekenregels; het model zelf draait in semantic-worker.js (browser) of
// via scripts/semantic-node.js (tests en het vooraf berekenen van de vectoren).

export const SEMANTIC = {
  model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  revision: '2c4055b12046f11709e9df2c122e59ffbdc2f900', // vaste versie, zodat het model niet ongemerkt verandert
  dtype: 'q8',
  downloadMb: 150, // model (118 MB) + woordenlijst (17 MB) + rekenmotor (±15-25 MB), eenmalig
};

// Drempels, afgesteld met de testset (scripts/bot-scenarios.js). Gelijkenis (cosinus) tussen -1 en 1.
// Eén vaste drempel werkt niet: ook onzin als "qwerty" of "blabla" scoort 0,8+, omdat het model altijd
// iets vindt dat er een beetje op lijkt. Wat wel onderscheidt: bij een echte vraag steekt de beste soort
// zaak ver boven de andere soorten uit. Daarom kijken we ook naar het verschil ("gap") tussen de beste
// soort en de 8e beste soort (per soort telt de beste treffer: een woord bij die soort of een zaak ervan).
// Bekende grens: een vraag die bij meerdere soorten past ("zin in een biertje": kroeg, bar of café)
// heeft een kleine gap en krijgt dus "weet ik niet". Dat is veilig, maar niet behulpzaam.
export const THRESHOLDS = {
  minTop: 0.7, // daaronder: "weet ik niet"
  minGap: 0.16, // beste soort moet minstens zoveel boven de 8e soort uitsteken, anders: "weet ik niet"
  gapRank: 8,
  sureTop: 0.85, // vanaf hier (en sureGap) zoeken we bij één zaak of plek direct; anders eerst vragen
  sureGap: 0.25,
  placeOverCategory: 0.04, // een losse zaak wint van een soort zaak als hij duidelijk beter past
};

// ---------- Opslag van de vectoren: per vector een schaal (float32) en de waarden als int8 ----------
export function quantize(vec) {
  let max = 0;
  for (const x of vec) max = Math.max(max, Math.abs(x));
  const scale = max / 127 || 1;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) q[i] = Math.round(vec[i] / scale);
  return { scale, q };
}

export function encodeIndex(vectors, dims) {
  const n = vectors.length;
  const buf = new ArrayBuffer(n * 4 + n * dims);
  const scales = new Float32Array(buf, 0, n);
  const q = new Int8Array(buf, n * 4, n * dims);
  vectors.forEach((v, i) => {
    if (v.length !== dims) throw new Error(`vector ${i} heeft ${v.length} dimensies, verwacht ${dims}`);
    const r = quantize(v);
    scales[i] = r.scale;
    q.set(r.q, i * dims);
  });
  return buf;
}

export function decodeIndex(meta, buf) {
  const n = meta.items.length;
  const dims = meta.dims;
  if (buf.byteLength !== n * 4 + n * dims) throw new Error('Vectorbestand past niet bij de lijst met items');
  return { meta, items: meta.items, dims, scales: new Float32Array(buf, 0, n), q: new Int8Array(buf, n * 4, n * dims) };
}

// Gelijkenis van de vraag met elk item (vectoren zijn genormaliseerd, dus het inproduct is de cosinus)
export function scoreAll(index, qvec) {
  const { items, dims, scales, q } = index;
  const out = new Float32Array(items.length);
  for (let i = 0; i < items.length; i++) {
    let s = 0;
    const off = i * dims;
    for (let d = 0; d < dims; d++) s += q[off + d] * qvec[d];
    out[i] = s * scales[i];
  }
  return out;
}

const round = (x) => Math.round(x * 1000) / 1000;

// Wat bedoelt de bestuurder? Eén zaak, een soort zaak, een bekende plek, of niets dat erop lijkt.
// Uitkomst: { kind: 'place'|'category'|'landmark'|'none', score, confident, ... }
export function interpret(index, scores, { limit = 4 } = {}) {
  const { items } = index;
  const catBest = new Map(); // soort zaak -> beste score (via zijn woorden)
  const placeScore = new Map(); // zaak-id -> score
  let bestPlace = null;
  let bestLm = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const s = scores[i];
    if (it.k === 'c') {
      if (!catBest.has(it.cat) || s > catBest.get(it.cat).score) catBest.set(it.cat, { score: s, phrase: it.text });
    } else if (it.k === 'p') {
      placeScore.set(i, s);
      if (!bestPlace || s > bestPlace.score) bestPlace = { i, score: s };
    } else if (it.k === 'l') {
      if (!bestLm || s > bestLm.score) bestLm = { i, score: s };
    }
  }
  let bestCat = null;
  for (const [cat, v] of catBest) if (!bestCat || v.score > bestCat.score) bestCat = { cat, ...v };

  const top = Math.max(bestCat?.score ?? -1, bestPlace?.score ?? -1, bestLm?.score ?? -1);
  // Per soort zaak (en per bekende plek) de beste score; de gap meten we tussen die groepen
  const groups = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const key = it.k === 'l' ? `l:${it.id}` : `c:${it.cat}`;
    if (!groups.has(key) || scores[i] > groups.get(key)) groups.set(key, scores[i]);
  }
  const ranked = [...groups.values()].sort((a, b) => b - a);
  const gap = top - (ranked[THRESHOLDS.gapRank - 1] ?? ranked[ranked.length - 1] ?? 0);
  const base = { score: round(top), gap: round(gap) };
  if (top < THRESHOLDS.minTop || gap < THRESHOLDS.minGap) return { kind: 'none', ...base, confident: false };
  const confident = top >= THRESHOLDS.sureTop && gap >= THRESHOLDS.sureGap;
  const place = (i) => ({ ...items[i], score: round(placeScore.get(i)) });

  if (bestLm && bestLm.score === top) return { kind: 'landmark', ...base, confident, landmark: items[bestLm.i] };

  if (bestPlace && (!bestCat || bestPlace.score >= bestCat.score + THRESHOLDS.placeOverCategory)) {
    // Andere zaken die bijna even goed passen, voor als we het niet zeker weten
    const alts = [...placeScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([i]) => place(i));
    return { kind: 'place', ...base, confident, place: place(bestPlace.i), alternatives: alts };
  }

  // Een soort zaak: de zaken van die soort die zelf het best bij de vraag passen
  const inCat = [...placeScore.entries()].filter(([i]) => items[i].cat === bestCat.cat).sort((a, b) => b[1] - a[1]);
  if (inCat.length === 1) return { kind: 'place', ...base, confident, place: place(inCat[0][0]), alternatives: [], category: bestCat.cat };
  return { kind: 'category', ...base, confident, category: bestCat.cat, phrase: bestCat.phrase, count: inCat.length, candidates: inCat.slice(0, limit).map(([i]) => place(i)) };
}

// Woorden die alleen iets over de rit zeggen (tijd, duur, parkeren). Blijft er na het weghalen
// daarvan niets over, dan is er ook niets om met AI te zoeken.
const TRIP_WORDS = new Set(
  ('ik je jij we wij u wil wilt willen ga gaat gaan moet moeten kan kun kunnen zou naar de het een bij in op aan van voor om tot vanaf na ' +
    'uur uurtje uurtjes uren minuten minuut min kwartier half kwart over dag dagje hele lang langer kort korter ' +
    'vandaag morgen overmorgen vanavond vanmiddag vanochtend vanmorgen ochtend middag avond nacht straks nu zo ' +
    'maandag dinsdag woensdag donderdag vrijdag zaterdag zondag weekend volgende week ' +
    'parkeren parkeer parkeerplek parkeerplaats plek plekje rijden staan neerzetten kwijt ' +
    'max maximaal hooguit lopen loopafstand euro gratis goedkoop goedkoopst goedkoopste duur garage garages straat p+r transferium ' +
    'waar wat hoe ergens graag even eens alsjeblieft liever alleen ook nog maar dan toch eigenlijk misschien wel niet geen is ben zijn ' +
    'please the a to at for near and hours hour minutes parking park').split(' '),
);
export function aiQuery(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+ ]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !TRIP_WORDS.has(w) && !/^\d+([.,:]\d+)?$/.test(w) && !/^\d+(u|e|ste|de)$/.test(w));
  return words.join(' ');
}

// Motor: laadt het model (via loadModel) en de vooraf berekende vectoren (via loadIndex) pas als het nodig is.
export function createSemanticEngine({ loadIndex, loadModel, supported = () => true }) {
  let status = supported() ? 'off' : 'unsupported'; // off | loading | ready | error | unsupported
  let index = null;
  let embed = null;
  let loading = null;
  let lastError = null;
  const listeners = new Set();
  const setStatus = (s) => {
    status = s;
    for (const fn of listeners) fn(s);
  };

  function enable(onProgress) {
    if (status === 'unsupported') return Promise.reject(new Error('Deze browser kan het AI-model niet draaien.'));
    if (status === 'ready') return Promise.resolve();
    loading ??= (async () => {
      setStatus('loading');
      try {
        const [idx, fn] = await Promise.all([loadIndex(), loadModel(onProgress)]);
        index = idx;
        embed = fn;
        setStatus('ready');
      } catch (err) {
        lastError = err;
        loading = null;
        setStatus('error');
        throw err;
      }
    })();
    return loading;
  }

  async function match(text) {
    if (status !== 'ready') throw new Error('AI-model is nog niet geladen');
    const query = aiQuery(text) || String(text);
    const qvec = await embed(query);
    const scores = scoreAll(index, qvec);
    return { query, ...interpret(index, scores) };
  }

  return {
    status: () => status,
    error: () => lastError,
    onStatus: (fn) => listeners.add(fn),
    enable,
    match,
    info: () => index?.meta ?? null,
  };
}
