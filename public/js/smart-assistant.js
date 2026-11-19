// De ingebouwde ParkSmart-assistent: werkt zonder account, sleutel of externe AI-dienst.
// Herkent wat de bestuurder vraagt (zoeken, vervolgvraag, één optie, openingstijden, navigeren),
// onthoudt het gesprek via de app-status en bouwt het antwoord uit de berekende feiten.
import { checkVisit } from './hours.js';
import { eur, duration, distance } from './format.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').replace(/[^a-z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const has = (text, re) => re.test(norm(text));

const RE = {
  thanks: /^(bedankt|dank je|dankjewel|dank u|thanks|top|super|prima|ok|oke|oké|helder|duidelijk)\b/,
  greet: /^(hoi|hallo|hey|hee|hi|goedemorgen|goedemiddag|goedenavond|yo)\b/,
  help: /\b(help|wat kun je|wat kan je|wat doe je|hoe werkt|wie ben je|wat ben je|uitleg)\b/,
  navigate: /\b(navigeer|navigatie|routebeschrijving|route ernaartoe|breng me|hoe kom ik er)\b/,
  detail: /\b(wat kost|hoeveel kost|prijs van|prijsopbouw|vertel meer|meer over|meer info|details?|hoe zit het met|info over|tarief van|uitleg over)\b/,
  hours: /\b(open|gesloten|dicht|sluit|sluiten|openingstijden|openingstijd|hoe laat)\b/,
  closer: /\b(dichterbij|dichter bij|minder lopen|korter lopen|minder ver|niet zo ver|dichtstbijzijnde|zo dichtbij mogelijk|zonder (veel )?lopen|weinig lopen|zo min mogelijk lopen)\b/,
  cheaper: /\b(goedkoper|het goedkoopst|goedkoopste)\b/,
  reset: /\b(alle opties|alles laten zien|zonder filters?|filters? weg|reset)\b/,
  why: /^(waarom|hoezo)\b/,
  parkingWords: /\b(parkeer|parkeren|parkeerplek|parkeerplaats|uur|min|minuten|gratis|garage|straat|p\+r|transferium|morgen|vandaag|zaterdag|zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|\d)\b/,
};
const ORDINALS = [
  [/\b(eerste|1e|nummer 1|optie 1)\b/, 0],
  [/\b(tweede|2e|nummer 2|optie 2)\b/, 1],
  [/\b(derde|3e|nummer 3|optie 3)\b/, 2],
];
// Woorden die niets zeggen over welke optie bedoeld wordt.
const GENERIC = new Set(['parkeergarage', 'garage', 'zone', 'parkeren', 'gratis', 'transferium', 'terrein', 'parkeerterrein', 'straat', 'langs', 'weg', 'aan', 'bij', 'de', 'het', 'van', 'den', 'bosch', 'hertogenbosch', 'station', 'p+r', 'pr', 't', 'uur', 'q', 'park']);
const COMMON = new Set(['gaat', 'gaan', 'hij', 'zij', 'die', 'deze', 'daar', 'hoe', 'laat', 'sluit', 'sluiten', 'open', 'gesloten', 'dicht', 'openingstijden', 'is', 'zijn', 'de', 'het', 'een', 'op', 'aan', 'in', 'bij', 'van', 'wat', 'wanneer', 'vandaag', 'morgen', 'nog', 'zaterdag', 'zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'straat']);

const HELP =
  'Ik zoek de goedkoopste en handigste parkeerplek in Den Bosch, met echte tarieven. Zo kun je het vragen:\n' +
  '- **2 uur bij de HEMA**\n- **zaterdag 14:00 drie uur naar de Sint-Jan, max 10 minuten lopen**\n- **gratis parkeren bij het station**\n' +
  'Daarna kun je doorvragen: "en voor 4 uur?", "dichterbij?", "alleen garages", "wat kost de tweede?" of "is de HEMA zaterdag open?".';

export function createSmartAssistant({ api, state, applySearch, searchSummary, findOption, toDest, localIso, nowRounded, navUrl }) {
  let last = null; // laatste zoekresultaat (zelfde volgorde als het kaartje in de chat)
  let lastPlace = null; // laatste winkel waar een openingstijdenvraag over ging

  const priced = (sum) => (sum?.options ?? []).filter((o) => o.total_eur != null);
  const price = (o) => (o.total_eur === 0 ? 'gratis' : `${o.source_trust === 'estimate' ? '≈ ' : ''}${eur(o.total_eur)}`);
  const walk = (o) => (o.shuttle ? 'met de bus of een leenfiets naar het centrum (inbegrepen)' : `${o.walk_minutes} min lopen`);
  const navAction = (id, name) => {
    const o = findOption(id);
    return o ? { label: `Navigeer naar ${name}`, href: navUrl(o) } : null;
  };

  // Lijkt de gevonden plek op wat de bestuurder typte? Naam, adres of soort zaak, met ruimte voor een typfout.
  function plausible(query, place) {
    if (String(place.id || '').startsWith('lm-')) return true;
    const hay = norm(`${place.label} ${place.kind ?? ''}`);
    const hayWords = hay.split(' ');
    return norm(query)
      .split(' ')
      .filter((t) => t.length >= 3 && !GENERIC.has(t) && !['wat', 'kun', 'kan', 'hoe', 'wil'].includes(t))
      .some((t) => hay.includes(t) || (t.length >= 4 && hayWords.some((w) => close(t, w))));
  }
  // Maximaal één letter verschil (toevoegen, weglaten of vervangen)
  function close(a, b) {
    if (Math.abs(a.length - b.length) > 1 || a === b) return a === b;
    let i = 0;
    let j = 0;
    let diff = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
        continue;
      }
      if (++diff > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else {
        i++;
        j++;
      }
    }
    return diff + (a.length - i) + (b.length - j) <= 1;
  }

  function visitNote(sum) {
    const d = sum.destination;
    if (!d.opening_hours_osm || !d.name) return null;
    const v = checkVisit(d.opening_hours_osm, new Date(sum.arrival), sum.duration_minutes);
    if (!v) return null;
    if (v.status === 'closed') return `Let op: ${d.name} is op ${v.dayName} gesloten (volgens OpenStreetMap).`;
    if (v.status === 'opens_later') return `Let op: ${d.name} gaat op ${v.dayName} pas om ${v.opensAt} open (volgens OpenStreetMap).`;
    if (v.status === 'closes_during') return `Let op: ${d.name} sluit om ${v.closesAt}, dus tijdens je bezoek (volgens OpenStreetMap).`;
    return `${d.name} is dan open tot ${v.closesAt}.`;
  }

  // ---------- Antwoord op een zoekopdracht ----------
  const TYPE_NL = { garage: 'garages', street: 'straat', pr: 'P+R', free: 'gratis' };
  function filterNote(sum) {
    const f = sum.filters;
    const bits = [];
    if (f.types.length < 4) bits.push(`alleen ${f.types.map((t) => TYPE_NL[t]).join(' en ')}`);
    if (f.max_walk_minutes != null && f.max_walk_minutes !== 20) bits.push(`max ${f.max_walk_minutes} min lopen`);
    if (f.max_price_eur != null) bits.push(`max ${eur(f.max_price_eur)}`);
    return bits.length ? `Filters: ${bits.join(' · ')}. Zeg **alle opties** om ze weg te halen.` : null;
  }

  function searchAnswer(sum, { assumedDuration = false, preferWalk = false } = {}) {
    let opts = priced(sum);
    if (!opts.length) {
      last = sum;
      return { text: `Met deze filters vind ik geen plek met een bekende prijs. Zeg bijvoorbeeld **alle opties** of geef een langere looptijd.${filterNote(sum) ? `\n\n${filterNote(sum)}` : ''}`, results: sum };
    }
    const cheapest = opts[0];
    let best = cheapest;
    const parts = [];
    if (preferWalk) {
      // "Dichterbij?": de dichtstbijzijnde optie voorop, de goedkoopste als alternatief.
      const walkable = [...opts, ...(sum.closest_other_options ?? [])].filter((o) => !o.shuttle);
      walkable.sort((a, b) => a.walk_minutes - b.walk_minutes || a.total_eur - b.total_eur);
      best = walkable[0] ?? cheapest;
      opts = [best, ...opts.filter((o) => o.id !== best.id)];
      sum = { ...sum, options: [best, ...sum.options.filter((o) => o.id !== best.id)] };
      parts.push(`Het dichtstbij parkeer je bij **${best.name}**: **${price(best)}** voor ${sum.duration_label}, ${walk(best)}.`);
      if (cheapest.id !== best.id) parts.push(`Het goedkoopst blijft ${cheapest.name}: ${price(cheapest)}, ${walk(cheapest)}.`);
    } else {
      parts.push(`**${best.name}** is het goedkoopst: **${price(best)}** voor ${sum.duration_label}, ${walk(best)}.`);
      const pool = [...opts, ...(sum.closest_other_options ?? [])].filter((o) => !o.shuttle && o.id !== best.id);
      const closer = pool
        .filter((o) => best.shuttle || o.walk_minutes <= best.walk_minutes - 4)
        .sort((a, b) => a.total_eur - b.total_eur || a.walk_minutes - b.walk_minutes)[0];
      if (closer) {
        const diff = closer.total_eur - best.total_eur;
        parts.push(`Minder lopen? **${closer.name}** kost ${price(closer)}${diff > 0.004 && best.total_eur > 0 ? ` (${eur(diff)} meer)` : ''} en is ${closer.walk_minutes} min lopen.`);
      }
      const garage = opts.find((o) => o.kind === 'Parkeergarage' && o.id !== best.id && o.id !== closer?.id);
      if (garage && best.kind !== 'Parkeergarage' && closer?.kind !== 'Parkeergarage') parts.push(`Liever een garage? ${garage.name}: ${price(garage)}, ${walk(garage)}.`);
    }
    last = sum;
    if (best.occupancy) parts.push(`Er zijn ${best.occupancy.vacant} van de ${best.occupancy.capacity} plekken vrij (stand ${best.occupancy.reading_time}).`);
    if (best.source_trust === 'community') parts.push('Deze plek komt uit OpenStreetMap: check ter plaatse de borden.');
    if (best.source_trust === 'estimate') parts.push('Dit bedrag is een schatting op basis van het tarief van vorig jaar.');
    const fn = filterNote(sum);
    if (fn) parts.push(fn);
    const vn = visitNote(sum);
    if (vn) parts.push(vn);
    if (assumedDuration) parts.push(`Ik ga uit van ${sum.duration_label}. Blijf je langer of korter? Zeg het maar.`);
    return { text: parts.join('\n\n'), results: sum, actions: [navAction(best.id, best.name)].filter(Boolean) };
  }

  // ---------- Eén optie uitleggen ----------
  function findMentionedOption(text) {
    const opts = state.results?.options ?? [];
    if (!opts.length) return null;
    const t = norm(text);
    for (const [re, idx] of ORDINALS) {
      if (re.test(t) && last) {
        const o = priced(last)[idx];
        if (o) return findOption(o.id);
      }
    }
    // Match op het onderscheidende deel van de naam ("wolvenhoek", "sint jan"), niet op losse woorden als "sint".
    let best = null;
    for (const o of opts) {
      const toks = norm(o.name).split(' ').filter((w) => !GENERIC.has(w));
      const phrase = toks.join(' ');
      let score = 0;
      if (phrase.length >= 4 && ` ${t} `.includes(` ${phrase} `)) score = 10 + phrase.length;
      else score = toks.filter((w) => w.length >= 6 && ` ${t} `.includes(` ${w} `)).length; // heel woord: "tolbrug" ≠ "tolbrugstraat"
      if (score && (!best || score > best.score)) best = { o, score };
    }
    return best?.o ?? null;
  }

  function detailAnswer(o) {
    const p = o.price;
    const lines = [];
    if (!p.feasible) lines.push(`**${o.name}** kan niet voor ${duration(state.durationMin)}: ${p.reason}`);
    else if (!p.known) lines.push(`Van **${o.name}** heb ik geen tarief: ${p.reason}`);
    else {
      lines.push(`**${o.name}** (${o.kind.toLowerCase()}) kost **${p.total === 0 ? 'niets' : `${p.estimated ? '≈ ' : ''}${eur(p.total)}`}** voor ${duration(state.durationMin)}${p.total > 0 ? `, gemiddeld ${eur(p.perHour)} per uur` : ''}.`);
      const rows = p.breakdown.filter((b) => b.minutes > 0 || b.cost !== 0);
      if (rows.length > 1) lines.push(rows.map((b) => `- ${b.label}${b.minutes ? ` (${duration(b.minutes)})` : ''}: ${b.cost === 0 ? '€ 0,00' : eur(b.cost)}`).join('\n'));
    }
    if (o.details?.paidTimes) lines.push(`Betaaltijden: ${o.details.paidTimes}.`);
    lines.push(o.shuttle ? `Vanaf hier neem je de bus of een leenfiets naar het centrum (${distance(o.walk.straightM)} hemelsbreed).` : `Lopen naar je bestemming: ongeveer ${o.walk.minutes} min (${distance(o.walk.meters)}).`);
    if (o.live) lines.push(`Bezetting: ${o.live.vacant} van ${o.live.capacity} vrij.`);
    if (o.warnings?.length) lines.push(`Let op: ${o.warnings[0]}`);
    lines.push(`Bron: ${o.source.label}.`);
    return { text: lines.join('\n\n'), actions: [{ label: `Navigeer naar ${o.name}`, href: navUrl(o) }], pick: o.id };
  }

  // ---------- Openingstijden ----------
  async function hoursAnswer(text, parsed) {
    let place = parsed.place && parsed.place.hours !== undefined ? parsed.place : null;
    if (!place && parsed.place && plausible(parsed.destination, parsed.place)) place = parsed.place;
    if (!place && lastPlace && (!parsed.destination || parsed.destination_guess)) place = lastPlace; // "hoe laat sluit hij?"
    if (!place && state.dest?.place) place = { ...state.dest.place, label: state.dest.label };
    const isBusiness = (p) => String(p?.id || '').startsWith('place-');
    const isLandmark = (p) => String(p?.id || '').startsWith('lm-');
    if (!place || (!isBusiness(place) && !isLandmark(place))) {
      // Winkelnaam ergens in de zin ("Wanneer gaat de Zara open?", "de Kruidvat op de Hooge Steenweg"):
      // zoek elk woord los op en kies de vestiging in de genoemde straat, of de dichtstbijzijnde bij het centrum.
      const street = place && !isBusiness(place) ? norm(place.label.split(',')[0]) : null;
      for (const word of norm(text).split(' ').filter((w) => w.length >= 3 && !COMMON.has(w) && !(street && street.includes(w)))) {
        const { results = [] } = await api.suggest(word).catch(() => ({}));
        const biz = results.filter((r) => isBusiness(r) && norm(r.name).startsWith(word));
        if (!biz.length) continue;
        const onStreet = street ? biz.find((b) => norm(b.address ?? '').includes(street)) : null;
        if (street && !onStreet) {
          return { text: `Ik vind geen ${biz[0].name} aan de ${place.label.split(',')[0]}. Deze vestigingen ken ik wel:\n${biz.slice(0, 4).map((b) => `- ${b.label}${b.hoursNl ? ` (${b.hoursNl})` : ''}`).join('\n')}` };
        }
        place = onStreet ?? biz[0];
        if (!onStreet && biz.length > 1) place = { ...place, others: biz.slice(1, 4) };
        break;
      }
    }
    if (place) lastPlace = place;
    if (!place) return { text: 'Van welke winkel of plek wil je de openingstijden weten? Bijvoorbeeld: **is de HEMA zaterdag open?**' };
    const name = place.name ?? place.label;
    if (!place.hours) return { text: `Van ${name} heb ik geen openingstijden. Kijk voor de zekerheid op hun website.` };
    let when = state.arrivalMode === 'later' && state.arrival ? new Date(state.arrival) : new Date();
    if (parsed.date || parsed.time) {
      const now = localIso(nowRounded());
      const date = parsed.date || now.slice(0, 10);
      when = new Date(`${date}T${parsed.time || (date !== now.slice(0, 10) ? '12:00' : now.slice(11, 16))}`);
    }
    const v = checkVisit(place.hours, when, 1);
    const day = v?.dayName ?? 'die dag';
    const lines = [];
    if (v?.hours) lines.push(`Volgens OpenStreetMap is **${name}**${place.address ? ` (${place.address})` : ''} op ${day} ${v.hours === 'gesloten' ? '**gesloten**' : `open van **${v.hours}**`}.`);
    if (v && (parsed.time || state.arrivalMode === 'later') && v.status === 'opens_later') lines.push(`Om ${when.toTimeString().slice(0, 5)} is het nog dicht; het gaat om ${v.opensAt} open.`);
    if (place.hoursNl) lines.push(`Alle openingstijden: ${place.hoursNl}.`);
    if (place.others?.length) lines.push(`Andere vestigingen: ${place.others.map((b) => b.address ?? b.label).join(' · ')}.`);
    lines.push('Zal ik een parkeerplek zoeken? Zeg bijvoorbeeld **2 uur** of **zaterdag 14:00 voor 3 uur**.');
    return { text: lines.join('\n\n') };
  }

  // ---------- Hoofdlogica ----------
  async function turn(text) {
    const r = await route(text);
    return r;
  }

  // Elk antwoord krijgt een intent-label (handig voor het testprogramma scripts/eval-bot.js).
  async function route(text) {
    const t = norm(text);
    if (!t) return { intent: 'help', text: HELP };
    const words = t.split(' ').length;
    if (RE.thanks.test(t) && words <= 4) return { intent: 'thanks', text: 'Graag gedaan! Vraag gerust verder als je ergens anders heen wilt of de tijd verandert.' };
    if ((RE.greet.test(t) && words <= 4) || RE.help.test(t)) return { intent: 'help', text: HELP };

    if (RE.navigate.test(t)) {
      const o = findMentionedOption(text) ?? (state.selectedId && findOption(state.selectedId)) ?? (last && priced(last)[0] && findOption(priced(last)[0].id));
      if (!o) return { intent: 'navigate', text: 'Zoek eerst een parkeerplek, dan geef ik je een navigatieknop. Bijvoorbeeld: **2 uur bij de Markt**.' };
      return { intent: 'navigate', text: `Hier is de route naar **${o.name}**. Je kunt ook in de lijst op een optie tikken en op Navigeer drukken.`, actions: [{ label: `Navigeer naar ${o.name}`, href: navUrl(o) }], pick: o.id };
    }

    // "die op de Tolbrugstraat" na een zoekopdracht naar een keten: dezelfde winkel, andere vestiging
    const branch = /^(?:en )?(?:die|de|het|degene|diegene|eentje)\s+(?:op|aan|in|bij)\s+(?:de |het )?(.+)$/.exec(t);
    if (branch && state.dest?.place) {
      const { result } = await api.geocode(`${state.dest.place.name} ${branch[1]}`);
      if (result && String(result.id).startsWith('place-') && norm(result.label).includes(norm(branch[1]).split(' ')[0])) {
        const res = await applySearch({ dest: toDest(result) });
        if (res.ok) return { intent: 'search', ...searchAnswer(searchSummary()) };
      }
    }

    // Vraag over één optie uit de lijst ("wat kost Wolvenhoek?", "meer over de tweede")
    const mentioned = findMentionedOption(text);
    const askHours = RE.hours.test(t);
    if (mentioned && (RE.detail.test(t) || ORDINALS.some(([re]) => re.test(t)) || (!askHours && !RE.parkingWords.test(t) && words <= 4) || (askHours && /\bgarage\b/.test(t)))) {
      return { intent: 'detail', ...detailAnswer(mentioned) };
    }
    if (RE.why.test(t) && last) {
      const b = priced(last)[0];
      return { intent: 'why', text: `Ik sorteer op de totaalprijs voor jouw parkeertijd, berekend met de echte tarieven en betaaltijden. ${b ? `**${b.name}** komt dan het laagst uit (${price(b)}).` : ''} Wil je liever minder lopen, zeg dan **dichterbij**.` };
    }

    const parsed = await api.aiParse(text);
    // "tot middernacht" zonder nieuwe begintijd: rekenen vanaf de aankomst die al gekozen was
    if (parsed.until && parsed.until_from_now && state.arrivalMode === 'later' && state.arrival) {
      const [uh, um] = parsed.until.split(':').map(Number);
      const start = new Date(state.arrival);
      const d = uh * 60 + um - (start.getHours() * 60 + start.getMinutes());
      if (d > 0) parsed.duration_minutes = d;
    }
    // "Is de HEMA zaterdag open?" / "hoe laat sluit de Jumbo" (geen parkeerduur gevraagd)
    if (RE.hours.test(t) && !parsed.duration_minutes && !/\b(parkeer|parkeren|parkeerplek)\b/.test(t)) return { intent: 'hours', ...(await hoursAnswer(text, parsed)) };

    // Vervolgvragen die alleen filters veranderen
    const refine = {};
    if (RE.closer.test(t)) Object.assign(refine, { sort: 'walk', maxWalk: Math.min(10, state.filters.maxWalk ?? 10) });
    if (RE.cheaper.test(t) && (!parsed.destination || parsed.destination_guess)) Object.assign(refine, { sort: 'price' });
    if (RE.reset.test(t)) Object.assign(refine, { types: null, maxWalk: null, maxPrice: null, sort: 'price' });

    // Andere onderwerpen, andere steden
    if (parsed.topic === 'permit') {
      return { intent: 'help', text: 'Parkeervergunningen en abonnementen regel je bij de gemeente \'s-Hertogenbosch. Ik vergelijk de kosten voor bezoekers: noem waar je heen gaat en hoe lang je blijft, bijvoorbeeld **3 uur bij de Markt**.' };
    }
    if (parsed.outside_city) {
      return { intent: 'outside', text: `ParkSmart werkt voorlopig alleen in Den Bosch, dus niet in ${parsed.outside_city}. Ga je naar een plek in Den Bosch? Noem die dan, bijvoorbeeld **2 uur bij het station**.` };
    }
    const hasTripInfo = Boolean(parsed.duration_minutes || parsed.date || parsed.time || parsed.types || parsed.max_price_eur || parsed.max_walk_minutes || Object.keys(refine).length);
    // Bij een ander onderwerp telt alleen een echte parkeervraag (duur, soort, prijs) mee, niet een losse dag ("weer morgen").
    const parkingAsked = Boolean(parsed.duration_minutes || parsed.types || parsed.max_price_eur || parsed.max_walk_minutes);
    if (parsed.topic === 'off_topic' && !parkingAsked && (!parsed.place || parsed.destination_guess)) {
      return { intent: 'unclear', text: `Daar kan ik je helaas niet mee helpen: ik ben er voor parkeren in Den Bosch.\n\n${HELP}` };
    }

    // Bestemming bepalen. Een bestemming die alleen uit losse woorden is geraden, telt pas als hij echt iets oplevert.
    let dest;
    if (parsed.place && parsed.placeInCity === false) return { intent: 'outside', text: 'Die plek ligt buiten Den Bosch. ParkSmart werkt voorlopig alleen in Den Bosch.' };
    if (parsed.place && !plausible(parsed.destination, parsed.place)) {
      parsed.place = null;
      if (!state.dest || !hasTripInfo) {
        return parsed.destination_guess && !hasTripInfo
          ? { intent: 'unclear', text: `Sorry, dat begrijp ik niet helemaal.\n\n${HELP}` }
          : { intent: 'unclear', text: `Ik weet niet zeker welke plek je bedoelt met "${parsed.destination}". Noem een winkel, straat of bekende plek in Den Bosch.` };
      }
      parsed.destination = null;
    }
    if (!parsed.place && parsed.destination_guess) {
      if (state.dest && hasTripInfo) parsed.destination = null; // alleen een vervolgvraag (tijd, duur, filter)
      else if (!state.dest && hasTripInfo) parsed.destination = null; // tijd/duur zonder plek: vraag waarheen
      else return { intent: 'unclear', text: `Sorry, dat begrijp ik niet helemaal.\n\n${HELP}` };
    }
    if (parsed.place) dest = toDest(parsed.place);
    else if (parsed.destination && !Object.keys(refine).length) return { intent: 'notfound', text: `Ik kan "${parsed.destination}" niet vinden in Den Bosch. Probeer een winkelnaam, straat of bekende plek.` };
    else if (!state.dest) return { intent: 'ask_destination', text: 'Waar wil je heen? Noem een winkel, straat of plek in Den Bosch, bijvoorbeeld: **2 uur bij de HEMA**.' };

    let arrival;
    if (parsed.date || parsed.time) {
      const now = localIso(nowRounded());
      let date = parsed.date || now.slice(0, 10);
      // "om 9 uur" terwijl het al middag is: dan bedoel je morgen
      if (!parsed.date && parsed.time && parsed.time < now.slice(11, 16)) {
        const d = new Date(`${date}T12:00`);
        d.setDate(d.getDate() + 1);
        date = localIso(d).slice(0, 10);
      }
      arrival = `${date}T${parsed.time || (date !== now.slice(0, 10) ? '10:00' : now.slice(11, 16))}`;
    }
    const isNewTrip = Boolean(dest);
    const res = await applySearch({
      dest,
      durationMin: parsed.duration_minutes || undefined,
      arrival,
      maxPrice: parsed.max_price_eur ?? refine.maxPrice,
      maxWalk: parsed.max_walk_minutes ?? refine.maxWalk,
      types: parsed.types ?? refine.types,
      sort: parsed.sort ?? refine.sort,
    });
    if (!res.ok) return { intent: 'error', text: res.message };
    return { intent: isNewTrip ? 'search' : 'refine', ...searchAnswer(searchSummary(), {
      assumedDuration: isNewTrip && !parsed.duration_minutes && state.durationMin === 120,
      preferWalk: RE.closer.test(t) || parsed.sort === 'walk',
    }) };
  }

  return { turn };
}
