// Terugval zonder AI: een eenvoudige Nederlandstalige parser en een advies-sjabloon.
// Zelfde uitvoerformaat als de AI-functies, zodat de frontend geen verschil hoeft te maken.

const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// now = Date met NL-wandklok als UTC
const NUMBER_WORDS = { een: 1, 'één': 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12, vijftien: 15, twintig: 20, dertig: 30, veertig: 40 };
const NUM_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b(?=\\s+(?:uur|uren|uurtje|uurtjes|minuten|min|minuutjes|dagen|dag)\\b)|(?<=\\b(?:half|om|vanaf|tot|rond)\\s+)\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'g');

export function parseRules(input, now) {
  let t = ` ${String(input || '').toLowerCase().replace(/\s+/g, ' ')} `;
  t = t.replace(NUM_RE, (w) => String(NUMBER_WORDS[w]));
  const out = {
    destination: null,
    date: null,
    time: null,
    duration_minutes: null,
    max_price_eur: null,
    max_walk_minutes: null,
    types: null,
    sort: null,
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

  // Loopafstand eerst (anders wordt "10 min" als parkeerduur gezien)
  take(/(?:max(?:imaal)?|hooguit|niet meer dan|binnen)?\s*(\d+)\s*(?:min(?:uten|uutjes|uut)?|m(?:eter)?)\s*(?:te\s+)?(?:lopen|loopafstand|wandelen|lopend)/, (m) => {
    const isMeter = /\d+\s*m(?:eter)?\s/.test(`${m[0]} `) && !/min/.test(m[0]);
    out.max_walk_minutes = isMeter ? Math.max(1, Math.round(num(m[1]) / 80)) : num(m[1]);
  });
  // Prijs (alleen met euroteken of het woord euro)
  take(/(?:max(?:imaal)?|onder(?: de)?|hooguit|niet meer dan|tot|voor minder dan)\s*(?:€\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:euro|eur\b|€))/, (m) => {
    out.max_price_eur = num(m[1] ?? m[2]);
  });
  // Datum
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const addDays = (n) => ymd(new Date(base.getTime() + n * 86400e3));
  if (!take(/\bovermorgen\b/, () => (out.date = addDays(2))))
    if (!take(/\bmorgen\b/, () => (out.date = addDays(1))))
      if (!take(/\bvandaag\b/, () => (out.date = addDays(0))))
        take(new RegExp(`\\b(${WEEKDAYS.join('|')})\\b`), (m) => {
          const target = WEEKDAYS.indexOf(m[1]);
          const diff = (target - base.getUTCDay() + 7) % 7;
          out.date = addDays(diff);
        });

  // Tijd. "om 3 uur" / "half 3" betekent overdag bijna altijd 15:00 / 14:30, tenzij 's nachts/'s ochtends.
  const night = /'s nachts|'s ochtends|'s morgens|vanochtend|vanmorgen/.test(t);
  const dayHour = (h) => (!night && h >= 1 && h <= 6 ? h + 12 : h);
  if (!take(/\b(?:om|vanaf|rond|tegen|van)\s+half\s+(\d{1,2})\b/, (m) => (out.time = `${pad(dayHour((num(m[1]) + 23) % 24))}:30`)))
    take(/\b(?:om|vanaf|rond|tegen|van)\s+(\d{1,2})(?:[:.u](\d{2}))?\s*(?:uur)?\b/, (m) => {
      const h = num(m[1]);
      if (h <= 24) out.time = `${pad(m[2] ? h % 24 : dayHour(h % 24))}:${m[2] ?? '00'}`;
    });
  const partOfDay = [
    [/\bvanavond\b|'s avonds|\bavond\b/, '19:00'],
    [/\bvanmiddag\b|'s middags/, '14:00'],
    [/\bvanochtend\b|vanmorgen|'s ochtends|'s morgens/, '09:00'],
  ];
  for (const [re, time] of partOfDay) {
    let word = null;
    if (take(re, (m) => (word = m[0]))) {
      out.time ??= time;
      if (word.startsWith('van')) out.date ??= addDays(0); // vanavond/vanmiddag/vanochtend = vandaag
      break;
    }
  }

  // Duur (na de tijd, zodat "om 3 uur" geen parkeerduur wordt)
  if (!take(/anderhalf uur/, () => (out.duration_minutes = 90)))
    if (!take(/(?:een\s+)?half(?:je)? uur(?:tje)?/, () => (out.duration_minutes = 30)))
      if (!take(/(?:de |een )?hele dag|dagje|werkdag/, () => (out.duration_minutes = 480)))
        if (!take(/(\d+)\s*(?:dagen|dag|etmalen|etmaal)\b/, (m) => (out.duration_minutes = Math.min(7, num(m[1])) * 1440)))
        if (!take(/(\d+(?:[.,]\d+)?)\s*(?:uurtjes?|uur|uren|u\b|h\b|hours?)/, (m) => (out.duration_minutes = Math.round(num(m[1]) * 60))))
          take(/(\d+)\s*(?:min(?:uten|uutjes)?)\b/, (m) => (out.duration_minutes = num(m[1])));
  take(/(?:een\s+)?kwartier(?:tje)?/, () => (out.duration_minutes ??= 15));

  // Tijd tot (bijv. "tot 17:00") -> duur
  take(/\btot\s+(\d{1,2})(?:[:.u](\d{2}))?\s*(?:uur)?\b/, (m) => {
    if (out.duration_minutes || !out.time) return;
    const [sh, sm] = out.time.split(':').map(Number);
    const end = num(m[1]) * 60 + num(m[2] ?? 0);
    const d = end - (sh * 60 + sm);
    if (d > 0) out.duration_minutes = d;
  });

  // Type
  const types = new Set();
  if (/\bgratis\b|\bniks betalen\b|kost niks/.test(t)) types.add('free');
  if (/\bgarage\b|parkeergarage/.test(t)) types.add('garage');
  if (/\bstraat\b|op straat|\bzone\b/.test(t)) types.add('street');
  if (/p\s?\+\s?r|transferium|park and ride|park & ride/.test(t)) types.add('pr');
  if (types.size) out.types = [...types];
  if (take(/zo dichtbij mogelijk|zo min mogelijk lopen|weinig lopen|kort(?:ste)? lopen|dichtstbijzijnde|dichtbij/, () => {})) out.sort = 'walk';
  else if (/goedkoop|goedkoopste|voordelig/.test(t)) out.sort = 'price';

  // Bestemming
  const stop = '(?=\\s+(?:voor|om|vanaf|van|tot|met|max|maximaal|en|morgen|vandaag|overmorgen|parkeren|' + WEEKDAYS.join('|') + ')\\b|[,.;!?]|\\s*$)';
  // "naar de HEMA", "bij Jan de Groot", "voor de Jumbo" (de duur "voor 2 uur" is hierboven al weggehaald)
  const dm = new RegExp(`\\b(?:naar|bij|vlakbij|in de buurt van|nabij|richting|rond|voor de|voor het|op de|op het|aan de)\\s+(?:de |het |een )?(.+?)${stop}`).exec(t);
  if (dm) out.destination = cleanDest(dm[1]);
  if (!out.destination) {
    const rest = cleanDest(
      t.replace(/\b(ik|wil|moet|ga|gaan|graag|waar|wat|welke|hoe|is|kan|mijn|parkeren|parkeer|parkeerplaats|parkeerplek|plek|auto|kwijt|zetten|neerzetten|zoek|zoeken|een|de|het|in|den bosch|'s-hertogenbosch|best|beste|goedkoop|goedkoopst|goedkoopste|gratis|garage|straat|lopen|max|maximaal|en|voor|om|uur|ongeveer)\b/g, ' '),
    );
    if (rest.length >= 3) out.destination = rest;
  }
  out.summary = summarize(out);
  return out;
}

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
