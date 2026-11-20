// Terugval zonder AI: een eenvoudige Nederlandstalige parser en een advies-sjabloon.
// Zelfde uitvoerformaat als de AI-functies, zodat de frontend geen verschil hoeft te maken.

const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const EN_DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const NUMBER_WORDS = { een: 1, 'één': 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12, vijftien: 15, twintig: 20, dertig: 30, veertig: 40, one: 1, two: 2, three: 3, four: 4, five: 5 };
const NW = Object.keys(NUMBER_WORDS).join('|');
// Geen lookbehind in reguliere expressies gebruiken: die kent Safari pas sinds iOS 16.4 en dan start de hele app niet.
// Daarom vangen we het voorzetsel ("half", "om", ...) in groep 2 en zetten het bij vervangen terug.
const NUM_RE = new RegExp(`\\b(${NW})\\b(?=\\s+(?:uur|uren|uurtje|uurtjes|minuten|min|minuutjes|dagen|dag|hours?|euro)\\b)|\\b((?:half|om|vanaf|tot|rond|over|voor)\\s+)(${NW})\\b(?!\\s+(?:uur|uren|uurtjes?|minuten|dagen))`, 'g');
const numWords = (t) => t.replace(NUM_RE, (w, a, pre, b) => (a ? String(NUMBER_WORDS[a]) : pre + NUMBER_WORDS[b]));

// Afkortingen en spreektaal -> wat de zoekfunctie kent
const SYNONYMS = [
  [/\b(ah|appie)\b/g, 'albert heijn'],
  [/\bbieb\b/g, 'bibliotheek'],
  [/\b(mac|mcd|mac donalds|mc donalds)\b/g, 'mcdonalds'],
  [/\bde stad\b/g, 'centrum'],
];

// Andere gemeenten (Rosmalen, Empel, Engelen en Nuland horen bij Den Bosch en staan hier dus niet in).
const OTHER_CITIES = ['amsterdam', 'rotterdam', 'utrecht', 'eindhoven', 'tilburg', 'breda', 'nijmegen', 'arnhem', 'den haag', 'haarlem', 'groningen', 'maastricht', 'zwolle', 'leiden', 'delft', 'helmond', 'oss', 'vught', 'zaltbommel', 'waalwijk', 'boxtel', 'veghel', 'uden', 'heusden', 'drunen', 'schijndel', 'sint-michielsgestel', 'sint michielsgestel', 'apeldoorn', 'amersfoort', 'venlo', 'roermond', 'gorinchem', 'dordrecht', 'efteling', 'kaatsheuvel'];

// Onderwerpen waar de assistent niet over gaat
const OFF_TOPIC = /\b(weer|weerbericht|regen|mop|grap|grapje|nieuws|recept|voetbaluitslag|uitslag|politiek|liedje|gedicht|huiswerk|hoe oud)\b/;

// now = Date met NL-wandklok als UTC
export function parseRules(input, now) {
  let t = ` ${String(input || '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ')} `;
  t = numWords(t);
  for (const [re, rep] of SYNONYMS) t = t.replace(re, rep);
  const out = {
    destination: null,
    destination_guess: false,
    date: null,
    time: null,
    duration_minutes: null,
    max_price_eur: null,
    max_walk_minutes: null,
    types: null,
    sort: null,
    outside_city: null,
    topic: null,
    summary: '',
  };
  const take = (re, fn) => {
    const m = re.exec(t);
    if (m) {
      fn(m);
      t = t.replace(m[0], ' ');
    }
    return Boolean(m);
  };
  const num = (s) => parseFloat(String(s).replace(',', '.'));

  if (OFF_TOPIC.test(t)) out.topic = 'off_topic';
  if (/\b(parkeer)?vergunning|bewonerskaart|\babonnement\b/.test(t)) out.topic = 'permit';
  const city = OTHER_CITIES.find((c) => new RegExp(`\\b${c}\\b`).test(t));
  if (city) out.outside_city = city.replace(/\b\w/g, (c) => c.toUpperCase());

  // Loopafstand eerst (anders wordt "10 min" als parkeerduur gezien)
  take(/(?:max(?:imaal)?|hooguit|niet meer dan|binnen)?\s*(\d+)\s*(?:min(?:uten|uutjes|uut)?|m(?:eter)?)\s*(?:te\s+)?(?:lopen|loopafstand|wandelen|lopend|walking|walk)/, (m) => {
    const isMeter = /\d+\s*m(?:eter)?\s/.test(`${m[0]} `) && !/min/.test(m[0]);
    out.max_walk_minutes = isMeter ? Math.max(1, Math.round(num(m[1]) / 80)) : num(m[1]);
  });
  // Prijs (alleen met euroteken of het woord euro)
  const money = '(?:€\\s*(\\d+(?:[.,]\\d+)?)|(\\d+(?:[.,]\\d+)?)\\s*(?:euro|eur\\b|€))';
  if (!take(new RegExp(`(?:max(?:imaal)?|onder(?: de)?|hooguit|niet meer dan|tot|voor minder dan|minder dan|budget(?: van)?|under)\\s*${money}`), (m) => (out.max_price_eur = num(m[1] ?? m[2]))))
    take(new RegExp(`${money}\\s*(?:of minder|of goedkoper|max(?:imaal)?|tops|hooguit)`), (m) => (out.max_price_eur = num(m[1] ?? m[2])));

  // Datum
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const addDays = (n) => ymd(new Date(base.getTime() + n * 86400e3));
  let dayPart = null;
  const dayRe = `(${WEEKDAYS.join('|')})`;
  if (!take(/\bovermorgen\b/, () => (out.date = addDays(2))))
    if (!take(/\bmorgen(ochtend|middag|avond)?\b|\btomorrow\b/, (m) => { out.date = addDays(1); dayPart = m[1] ?? null; }))
      if (!take(/\bvandaag\b|\btoday\b/, () => (out.date = addDays(0))))
        if (!take(new RegExp(`\\bvolgende week(?: op)?\\s+${dayRe}\\b`), (m) => {
          const toMonday = (8 - base.getUTCDay()) % 7 || 7;
          out.date = addDays(toMonday + ((WEEKDAYS.indexOf(m[1]) + 6) % 7));
        }))
          if (!take(/\bvolgende week\b/, () => (out.date = addDays(7))))
            take(new RegExp(`\\b(?:aanstaande |komende |deze )?(${WEEKDAYS.join('|')}|${Object.keys(EN_DAYS).join('|')})\\b`), (m) => {
              const target = WEEKDAYS.includes(m[1]) ? WEEKDAYS.indexOf(m[1]) : EN_DAYS[m[1]];
              out.date = addDays((target - base.getUTCDay() + 7) % 7);
            });

  // Tijd. "om 3 uur" / "half 3" betekent overdag bijna altijd 15:00 / 14:30, tenzij 's nachts/'s ochtends.
  const night = /'s nachts|'s ochtends|'s morgens|vanochtend|vanmorgen/.test(t) || dayPart === 'ochtend';
  const dayHour = (h) => (!night && h >= 1 && h <= 6 ? h + 12 : h);
  const pre = '(?:\\b(?:om|vanaf|rond|tegen|at)\\s+)?';
  if (!take(new RegExp(`${pre}\\bkwart over (\\d{1,2})\\b`), (m) => (out.time = `${pad(dayHour(num(m[1]) % 24))}:15`)))
    if (!take(new RegExp(`${pre}\\bkwart voor (\\d{1,2})\\b`), (m) => (out.time = `${pad(dayHour((num(m[1]) + 23) % 24))}:45`)))
      if (!take(new RegExp(`${pre}\\bhalf (\\d{1,2})\\b(?! uur)`), (m) => (out.time = `${pad(dayHour((num(m[1]) + 23) % 24))}:30`)))
        take(/\b(?:om|vanaf|rond|tegen|van|at)\s+(\d{1,2})(?:[:.u](\d{2}))?\s*(?:uur|u)?\b(?!\s*(?:lang|parkeren))/, (m) => {
          const h = num(m[1]);
          if (h <= 24) out.time = `${pad(m[2] ? h % 24 : dayHour(h % 24))}:${m[2] ?? '00'}`;
        });
  // Losse tijd zonder "om", bijv. "zaterdag 14:00" (een eindtijd met "tot" wordt hieronder als duur gelezen)
  if (!out.time) {
    const m = [...t.matchAll(/(tot )?\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)].find((x) => !x[1]);
    if (m) {
      out.time = `${pad(num(m[2]))}:${m[3]}`;
      t = t.replace(m[0], ' ');
    }
  }
  if (dayPart) out.time ??= { ochtend: '09:00', middag: '14:00', avond: '19:00' }[dayPart];
  const partOfDay = [
    [/\bvanavond\b|'s avonds|\bavond\b|\btonight\b/, '19:00'],
    [/\bvanmiddag\b|'s middags/, '14:00'],
    [/\bvanochtend\b|vanmorgen|'s ochtends|'s morgens/, '09:00'],
  ];
  for (const [re, time] of partOfDay) {
    let word = null;
    if (take(re, (m) => (word = m[0]))) {
      out.time ??= time;
      if (/^(van|tonight)/.test(word)) out.date ??= addDays(0); // vanavond/vanmiddag/vanochtend = vandaag
      break;
    }
  }

  // Duur (na de tijd, zodat "om 3 uur" geen parkeerduur wordt)
  if (!take(/anderhalf uur/, () => (out.duration_minutes = 90)))
    if (!take(/(?:een\s+)?half(?:je)? uur(?:tje)?|half an hour/, () => (out.duration_minutes = 30)))
      if (!take(/\b(?:de |een |the )?hele (?:dag|middag|ochtend)\b|\bdagje\b|\bwerkdag\b|\ball day\b|\bwhole day\b/, (m) => (out.duration_minutes = /middag|ochtend/.test(m[0]) ? 240 : 480)))
        if (!take(/(?:een )?paar uur(?:tjes)?|a few hours|couple of hours/, () => (out.duration_minutes = 120)))
          if (!take(/(\d+)\s*(?:dagen|dag|etmalen|etmaal|days?)\b/, (m) => (out.duration_minutes = Math.min(7, num(m[1])) * 1440)))
            if (!take(/(\d+(?:[.,]\d+)?)\s*(?:uurtjes?|uur|uren|u\b|h\b|hours?|hrs?)/, (m) => (out.duration_minutes = Math.round(num(m[1]) * 60))))
              take(/(\d+)\s*(?:min(?:uten|uutjes)?|minutes?)\b/, (m) => (out.duration_minutes = num(m[1])));
  take(/\b(?:een\s+)?kwartier(?:tje)?\b/, () => (out.duration_minutes ??= 15)); // \b: niet in "Paleiskwartier"
  if (!out.duration_minutes && take(/\b(?:een )?uurtje\b|\ban hour\b/, () => {})) out.duration_minutes = 60;

  // Tijd tot (bijv. "tot 17:00") -> duur; zonder starttijd rekenen we vanaf nu
  t = t.replace(/\b(tot|until|till) (middernacht|midnight|12 uur 's nachts)\b/, '$1 24:00');
  take(/\b(?:tot|until|till)\s+(\d{1,2})(?:[:.u](\d{2}))?\s*(?:uur)?\b/, (m) => {
    if (out.duration_minutes) return;
    const start = out.time ? out.time.split(':').map(Number) : [now.getUTCHours(), now.getUTCMinutes()];
    let endH = num(m[1]);
    if (!m[2] && endH <= 6 && start[0] >= 7) endH += 12; // "tot 5" = 17:00
    const endMin = endH * 60 + num(m[2] ?? 0);
    out.until = `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`; // de assistent rekent dit opnieuw uit vanaf de gekozen aankomst
    out.until_from_now = !out.time;
    const d = endMin - (start[0] * 60 + start[1]);
    if (d > 0) out.duration_minutes = d;
  });

  // Type
  const types = new Set();
  if (/\bgratis\b|\bniks betalen\b|kost niks|\bfree\b|zonder te betalen/.test(t)) types.add('free');
  if (/\bgarages?\b|parkeergarage|\bparking garage\b/.test(t)) types.add('garage');
  if (/\bop straat\b|\bstraatparkeren\b|\bzone\b|\blangs de weg\b/.test(t)) types.add('street');
  if (/p\s?\+\s?r|transferium|park and ride|park & ride/.test(t)) types.add('pr');
  if (types.size) out.types = [...types];
  if (take(/zo dichtbij mogelijk|zo min mogelijk lopen|weinig lopen|zonder (?:veel )?lopen|kort(?:ste)? lopen|dichtstbijzijnde|dichterbij|dichtbij|closest|nearest/, () => {})) out.sort = 'walk';
  else if (/goedkoop|goedkoopste|voordelig|cheap/.test(t)) out.sort = 'price';

  // Bestemming
  const stop = `(?=\\s+(?:voor|om|vanaf|van|tot|met|max|maximaal|en|morgen|vandaag|overmorgen|parkeren|parkeer|zijn|komen|gaan|ga|moet|wil|waar|wat|hoe|is|open|dicht|gesloten|sluit|for|at|tomorrow|today|${WEEKDAYS.join('|')})\\b|[,.;!?]|\\s*$)`;
  // "naar de HEMA", "bij Jan de Groot", "voor de Jumbo", "in Paleiskwartier" (de duur "voor 2 uur" is hierboven al weggehaald)
  const dm = new RegExp(`\\b(?:naar|bij|vlakbij|in de buurt van|nabij|richting|rond|voor de|voor het|op de|op het|aan de|in de|in|near|to|at)\\s+(?:de |het |een |the )?(.+?)${stop}`).exec(t);
  if (dm) out.destination = cleanDest(dm[1]);
  if (!out.destination) {
    const rest = cleanDest(t.replace(FILLER, ' '));
    if (rest.length >= 3) {
      out.destination = rest;
      out.destination_guess = true; // geraden uit losse woorden: alleen gebruiken als het echt iets oplevert
    }
  }
  if (out.outside_city && out.destination && new RegExp(out.outside_city, 'i').test(out.destination)) out.destination = null;
  out.summary = summarize(out);
  return out;
}

// Woorden die nooit een bestemming zijn (voor het raden uit losse woorden)
const FILLER = new RegExp(
  `\\b(${[
    'ik', 'je', 'jij', 'we', 'wij', 'wil', 'wilt', 'willen', 'moet', 'moeten', 'ga', 'gaan', 'graag', 'liever', 'waar', 'wat', 'welke', 'hoe', 'is', 'er', 'ben', 'kan', 'kun',
    'mijn', 'onze', 'parkeren', 'parkeer', 'parkeerplaats', 'parkeerplek', 'parkeerplekje', 'plek', 'plekje', 'plaats', 'auto', 'kwijt', 'zetten', 'neerzetten', 'zoek', 'zoeken',
    'een', 'de', 'het', 'in', 'den bosch', "'s-hertogenbosch", 'best', 'beste', 'goedkoop', 'goedkoopst', 'goedkoopste', 'gratis', 'garage', 'garages', 'straat', 'lopen', 'max',
    'maximaal', 'en', 'voor', 'om', 'uur', 'ongeveer', 'open', 'gesloten', 'dicht', 'sluit', 'sluiten', 'openingstijden', 'laat', 'zijn', 'nog', 'alleen', 'ook', 'iets', 'ergens',
    'zonder', 'veel', 'weinig', 'met', 'wel', 'niet', 'toch', 'even', 'daar', 'hier', 'dan', 'of', 'ok', 'oke', 'nee', 'ja', 'parking', 'for', 'the', 'please', 'i', 'need', 'want',
    'where', 'can', 'park', 'hours', 'hour', 'duur', 'kost', 'kosten', 'prijs', 'parkeerkosten', 'lang', 'blijven', 'blijf',
    'hij', 'zij', 'ze', 'die', 'dat', 'deze', 'hem', 'haar', 'op', 'aan', 'tot', 'over', 'naar', 'bij',
    'wanneer', 'gaat', 'goedkoper', 'duurder', 'sneller', 'beter', 'mag', 'zou', 'als', 'komen', 'kom', 'bezoek', 'bezoeken',
    'vergadering', 'afspraak', 'beurs', 'wedstrijd', 'concert', 'voorstelling',
  ].join('|')})\\b`,
  'g',
);

function cleanDest(s) {
  return String(s || '')
    .replace(/\b(in |te )?(den bosch|'s-hertogenbosch|s-hertogenbosch)\b/g, '')
    .replace(/[^\p{L}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function summarize(q) {
  const parts = [];
  if (q.destination) parts.push(`naar ${q.destination}`);
  if (q.duration_minutes) parts.push(`${q.duration_minutes % 60 ? `${q.duration_minutes} min` : `${q.duration_minutes / 60} uur`} parkeren`);
  if (q.date || q.time) parts.push(`aankomst ${[q.date, q.time].filter(Boolean).join(' ')}`);
  if (q.max_price_eur) parts.push(`max €${q.max_price_eur}`);
  if (q.max_walk_minutes) parts.push(`max ${q.max_walk_minutes} min lopen`);
  return parts.length ? `Je zoekt: ${parts.join(', ')}.` : 'Ik kon weinig uit je zin halen. Probeer bijvoorbeeld: "3 uur bij de Markt".';
}

const e = (x) => `€${x.toFixed(2).replace('.', ',')}`;

export function adviceRules(ctx) {
  const opts = ctx.options ?? [];
  const priced = opts.filter((o) => o.total != null);
  if (!priced.length) {
    return { headline: 'Geen opties met bekende prijs', advice: 'Met deze filters vind ik geen parkeerplek met een bekende prijs. Verruim de loopafstand of de maximumprijs.', recommended_id: null, tip: null };
  }
  const best = priced[0];
  const walkTxt = (o) => (o.shuttle ? 'met bus of leenfiets naar het centrum' : `${o.walk_min} min lopen`);
  let advice =
    best.total === 0
      ? `${best.name} is gratis voor ${ctx.duration_label}, ${walkTxt(best)}.`
      : `${best.name} is het goedkoopst: ${e(best.total)} voor ${ctx.duration_label}, ${walkTxt(best)}.`;
  const closer = priced.find((o) => !o.shuttle && o.walk_min + 4 <= (best.shuttle ? 99 : best.walk_min) && o.total - best.total <= 3);
  if (closer && closer.id !== best.id) {
    advice += ` Wil je minder lopen? ${closer.name} kost ${e(closer.total - best.total)} meer, maar scheelt ${(best.shuttle ? '' : best.walk_min - closer.walk_min + ' min ')}lopen.`;
  }
  const priciest = priced[priced.length - 1];
  if (priciest.total - best.total >= 1) advice += ` Je bespaart ${e(priciest.total - best.total)} ten opzichte van ${priciest.name}.`;
  const tip =
    best.source_trust === 'community'
      ? 'Deze info komt uit OpenStreetMap. Check de borden ter plaatse.'
      : best.source_trust === 'estimate'
        ? 'Dit bedrag is een schatting op basis van het tarief van vorig jaar.'
        : best.notes?.[0] ?? null;
  return { headline: `Goedkoopst: ${best.name}`, advice, recommended_id: best.id, tip };
}
