// AI-laag met Claude: (1) vrije tekst -> zoekparameters, (2) advies over berekende opties.
// Zonder API-sleutel (of bij een fout) valt alles terug op server/rules.js.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { parseRules, adviceRules } from './rules.js';

const MODEL = process.env.PARKSMART_MODEL || 'claude-opus-5-5';
let client = null;
let disabledReason = null;

export function aiStatus() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (!hasKey) return { enabled: false, model: MODEL, reason: 'Geen ANTHROPIC_API_KEY ingesteld' };
  if (disabledReason) return { enabled: false, model: MODEL, reason: disabledReason };
  return { enabled: true, model: MODEL };
}

function getClient() {
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return client;
}

async function callStructured({ system, user, schema, maxTokens = 4000 }) {
  const res = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    // Bij een weigering door de veiligheidsfilters probeert de API automatisch een passend fallback-model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Verzoek geweigerd door het model');
  if (res.stop_reason === 'max_tokens') throw new Error('Antwoord afgekapt');
  if (!res.parsed_output) throw new Error('Geen geldig gestructureerd antwoord');
  return { data: res.parsed_output, model: res.model };
}

function handleError(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    disabledReason = 'API-sleutel ongeldig of zonder toegang';
  } else if (err instanceof Anthropic.RateLimitError) {
    console.warn('[ai] rate limit, terugval op regels');
  } else if (err instanceof Anthropic.APIError) {
    console.warn(`[ai] API-fout ${err.status}: ${err.message}`);
  } else {
    console.warn(`[ai] ${err.message}`);
  }
}

// ---------- 1. Vrije tekst -> zoekparameters ----------
const QuerySchema = z.object({
  destination: z.string().nullable(),
  date: z.string().nullable(),
  time: z.string().nullable(),
  duration_minutes: z.number().nullable(),
  max_price_eur: z.number().nullable(),
  max_walk_minutes: z.number().nullable(),
  types: z.array(z.enum(['garage', 'street', 'pr', 'free'])).nullable(),
  sort: z.enum(['price', 'walk']).nullable(),
  summary: z.string(),
});

const PARSE_SYSTEM = `You convert a driver's request (usually in Dutch) into search parameters for ParkSmart, a parking price comparison app that only covers the municipality of 's-Hertogenbosch (Den Bosch), the Netherlands.

Fill the fields like this:
- destination: where the driver wants to go, phrased so the app's search finds it. That can be a shop, restaurant, business or other place by name (keep the name exactly, plus the street if given, e.g. "HEMA", "Albert Heijn Vughterstraat", "Jan de Groot"), a type of place ("apotheek", "kapper"), a landmark ("Sint-Janskathedraal", "Markt") or an address ("Vughterstraat 120"). Drop filler words such as "parkeren", "bij", "naar", "voor de". Use null when no destination is given or the driver wants their current location.
- date (YYYY-MM-DD) and time (HH:MM, 24-hour): resolve relative words (vandaag, morgen, zaterdag, vanavond = 19:00, vanmiddag = 14:00, 's ochtends = 09:00) against the current date and time in the message. Use null when not mentioned.
- duration_minutes: how long they park. "hele dag" = 480, "half uurtje" = 30. If they give an end time, compute the duration from the start time. Use null when not mentioned.
- max_price_eur and max_walk_minutes: only when the driver states a limit. Convert walking distances to minutes at 80 metres per minute.
- types: only when the driver restricts the kind of parking: garage (parkeergarage or terrein), street (straatparkeren, zone), pr (P+R, transferium), free (gratis). Otherwise null.
- sort: "walk" when walking as little as possible matters most, "price" when they ask for the cheapest, otherwise null.
- summary: one short Dutch sentence that restates what you understood, informal "je".

If the destination is outside Den Bosch, still fill it in; the app tells the driver it only covers Den Bosch.`;

function nowLabel(now) {
  const days = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const iso = now.toISOString().slice(0, 16);
  return `${days[now.getUTCDay()]} ${iso.replace('T', ' ')}`;
}

// allowAi: functie die bepaalt of dit verzoek (binnen de limieten) Claude mag gebruiken.
export async function parseQuery(text, now, { allowAi = () => true } = {}) {
  const clean = String(text || '').slice(0, 500);
  let limited = false;
  if (aiStatus().enabled && !(limited = !allowAi())) {
    try {
      const { data, model } = await callStructured({
        system: PARSE_SYSTEM,
        user: `Huidige datum en tijd (Europe/Amsterdam): ${nowLabel(now)}\n\nVerzoek van de bestuurder:\n"""${clean}"""`,
        schema: QuerySchema,
        maxTokens: 3000,
      });
      return { ...data, source: 'ai', model };
    } catch (err) {
      handleError(err);
    }
  }
  return { ...parseRules(clean, now), source: 'rules', limited };
}

// ---------- 2. Advies over de berekende opties ----------
const AdviceSchema = z.object({
  headline: z.string(),
  advice: z.string(),
  recommended_id: z.string().nullable(),
  tip: z.string().nullable(),
});

const ADVICE_SYSTEM = `You are the parking advisor inside ParkSmart for 's-Hertogenbosch (Den Bosch). You receive JSON with the driver's search and parking options the app has already calculated, sorted from cheapest to most expensive. Write advice in Dutch for the driver: informal "je", natural sentences, no lists.

Rules:
- Use only facts from the JSON. Never invent prices, free spaces, opening hours, bus times or rules.
- source_trust tells you how reliable a price is: "official" (municipal decree or RDW open data), "operator" (operator data via RDW), "community" (OpenStreetMap), "estimate" (calculated with last year's tariff because this year's decree is not in the app yet). When you recommend a non-official option, say briefly that the driver should check on site; for "estimate", call the price an estimate.
- Only mention free spaces when the option has "live" data, and say it is live.
- When the cheapest option needs a much longer walk, compare it with a closer option in exact euros and minutes, for example "voor €2,10 meer loop je 9 minuten minder".
- destination_place, when present, is the shop or business the driver is going to (from OpenStreetMap). If it has opening_hours_osm (OpenStreetMap syntax, e.g. "Mo-Sa 09:00-18:00; Su 12:00-17:00"), check them against the arrival time and parking duration. Mention it briefly when the place is closed at arrival or closes during the stay, and say the hours come from OpenStreetMap. If the hours are missing or you cannot tell, say nothing about them.
- Options with shuttle: true are transferia; the price includes a bus or rental bike to the centre for up to 4 people. Mention that instead of the walking time.
- headline: at most 8 words. advice: 2 or 3 sentences, at most 60 words. tip: one extra practical tip taken from the data (for example evening rate, maximum stay, first hours free), or null.
- recommended_id: the id of the option you recommend.`;

const adviceCache = new Map();

export async function advise(ctx, { allowAi = () => true } = {}) {
  const key = JSON.stringify(ctx);
  const hit = adviceCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.value;
  let value = null;
  let limited = false;
  if (aiStatus().enabled && ctx.options?.length && !(limited = !allowAi())) {
    try {
      const { data, model } = await callStructured({
        system: ADVICE_SYSTEM,
        user: JSON.stringify(ctx),
        schema: AdviceSchema,
        maxTokens: 3000,
      });
      const ids = new Set(ctx.options.map((o) => o.id));
      value = { ...data, recommended_id: ids.has(data.recommended_id) ? data.recommended_id : null, source: 'ai', model };
    } catch (err) {
      handleError(err);
    }
  }
  value ??= { ...adviceRules(ctx), source: 'rules', limited };
  if (limited) return value; // niet cachen: na de limiet mag Claude het later weer doen
  adviceCache.set(key, { at: Date.now(), value });
  if (adviceCache.size > 200) adviceCache.delete(adviceCache.keys().next().value);
  return value;
}
