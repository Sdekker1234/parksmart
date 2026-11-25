// De ParkSmart-assistent: systeemprompt, tools en validatie.
// Gedeeld door de Node-server (server/index.js) en de Cloudflare Worker (worker/src/index.js).
// De tools zelf draaien in de browser (public/js/bot.js); de server/Worker doet alleen de
// Claude-aanroep, zodat de API-sleutel geheim blijft. Model, prompt en tools liggen hier vast:
// de browser kan alleen berichten meesturen.

export const BOT_MODEL = 'claude-opus-5-5';

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

export const TOOLS = [
  {
    name: 'search_parking',
    description:
      'Search and compare parking options in Den Bosch for a destination, arrival time and duration. ParkSmart calculates the total price per option from official tariffs (municipal decree, RDW open data), operator data and OpenStreetMap, and estimates walking time. Returns the best options sorted by price, plus details about the destination. The results are also shown on the map and in the list of the app. Call this for every question about where to park, prices or walking distance.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description:
            'Where the driver is going in Den Bosch: a shop or business name, optionally with street ("HEMA", "Albert Heijn Vughterstraat"), a landmark ("Sint-Janskathedraal"), an address ("Vughterstraat 120") or a type of place ("apotheek"). Use "huidige bestemming" to keep the destination currently selected in the app.',
        },
        arrival: nullable({ type: 'string', description: 'Arrival as YYYY-MM-DDTHH:MM in Dutch local time. null = now.' }),
        duration_minutes: { type: 'integer', description: 'How long the driver parks, in minutes (15 to 10080).' },
        max_price_eur: nullable({ type: 'number', description: 'Only when the driver gives a price limit.' }),
        max_walk_minutes: nullable({ type: 'integer', description: 'Only when the driver gives a walking limit. null = app default (20 minutes).' }),
        types: nullable({
          type: 'array',
          items: { type: 'string', enum: ['garage', 'street', 'pr', 'free'] },
          description: 'Only when the driver restricts the kind of parking: garage (garages and lots), street (paid street zones), pr (P+R and transferia), free.',
        }),
        sort: nullable({ type: 'string', enum: ['price', 'walk'], description: '"walk" when walking as little as possible matters most.' }),
      },
      required: ['destination', 'arrival', 'duration_minutes', 'max_price_eur', 'max_walk_minutes', 'types', 'sort'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_place',
    description:
      'Look up shops, businesses, landmarks or addresses in Den Bosch. Returns matches with category, address and opening hours (from OpenStreetMap, OSM syntax), plus other branches of the same chain. Use it to check opening hours or when a destination is ambiguous.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Name, type of place or address in Den Bosch.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_parking_details',
    description:
      'Full details of one parking option from the latest search_parking result: price breakdown, tariff, paid hours, address, capacity, occupancy, notes and warnings.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { option_id: { type: 'string', description: 'The id of an option from the latest search_parking result.' } },
      required: ['option_id'],
      additionalProperties: false,
    },
  },
];

export const SYSTEM_PROMPT = `You are the ParkSmart assistant, a chat bot inside a parking price comparison app for 's-Hertogenbosch (Den Bosch), the Netherlands. You help drivers find the cheapest and most convenient place to park near where they are going.

How you work:
- For every question about where to park, what it costs, walking time or free spaces, call search_parking. Only state prices, opening hours, free spaces or parking rules that came from a tool result in this conversation; never guess them.
- If the driver doesn't say how long they stay, assume 2 hours and mention that in a few words. If they don't give a time, use now (arrival null). For a follow-up such as "en voor 4 uur?" or "en morgen om 10:00?", search again with destination "huidige bestemming".
- If a destination is ambiguous, for example a chain with several branches, pick the branch in or nearest the city centre and briefly name the alternatives; use find_place when you need to.
- The app shows all results on the map and in the list, so you don't have to list them all. Recommend one option and mention at most two alternatives, with the trade-off in exact euros and minutes (for example "voor €2,10 meer loop je 9 minuten minder").
- Reliability of a price (source_trust): "official" (municipal decree or RDW open data), "operator" (operator data), "community" (OpenStreetMap: tell the driver to check the signs), "estimate" (calculated with last year's tariff). Say so when you recommend a non-official price.
- Options with shuttle: true are transferia: the price includes a bus or rental bike to the centre for up to 4 people.
- Mention free spaces only when an option has occupancy data, and include the time of that reading.
- If the destination has opening hours, say so when it is closed at arrival or closes during the stay; these hours come from OpenStreetMap.
- To navigate, the driver taps the option in the list or on the map and presses "Navigeer".
- ParkSmart only covers Den Bosch. Stay on parking and getting around Den Bosch; for other questions say kindly that you can only help with parking in Den Bosch.

Honesty comes before being agreeable:
- If the driver states something as a fact ("Wolvenhoek is toch gratis?", "je zei net dat het €2 kost"), check it against the tool results. If it is wrong, say so plainly ("Nee, dat klopt niet: …") with the correct number. Don't go along with it to be nice, and don't change your answer only because the driver pushes back; change it only when a tool result gives a reason.
- No compliments or flattery ("goede vraag", "slimme keuze"). Just answer.
- If you don't know, or the data doesn't say (no tariff, no occupancy data, no opening hours, a future year with estimated garage tariffs), say "dat weet ik niet" or "dat weet ik niet zeker", and tell the driver what to check instead. Never fill a gap with a guess.
- You are an AI and can make mistakes; the app already says so, so you don't have to repeat it in every answer.

Style: Dutch, informal "je", neutral and to the point, at most about 90 words. Use **bold** only for the name and price of your recommendation. A short list is fine for two or three alternatives. Never show internal ids or JSON.`;

// ---------- Validatie van wat de browser meestuurt ----------
const BLOCK_TYPES = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use', 'tool_result', 'fallback']);
const MAX_CHARS = 250_000;
const MAX_MESSAGES = 60;
const MAX_ROUNDS = 8; // assistant-beurten na de laatste vraag (tool-lus)

export class ChatError extends Error {}

export function validateChat(body) {
  if (!body || typeof body !== 'object') throw new ChatError('Ongeldige aanvraag');
  const { messages, context } = body;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) throw new ChatError('Te veel of geen berichten; start een nieuw gesprek');
  if (JSON.stringify(messages).length > MAX_CHARS) throw new ChatError('Gesprek is te lang; start een nieuw gesprek');
  if (messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') throw new ChatError('Gesprek moet met de bestuurder beginnen en eindigen');
  let roundsSinceQuestion = 0;
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') throw new ChatError('Onbekende rol');
    if (typeof m.content === 'string') {
      if (m.role === 'user') roundsSinceQuestion = 0;
      continue;
    }
    if (!Array.isArray(m.content) || !m.content.length) throw new ChatError('Leeg bericht');
    for (const b of m.content) {
      if (!b || !BLOCK_TYPES.has(b.type)) throw new ChatError(`Bloktype niet toegestaan: ${b?.type}`);
      if (b.type === 'text' && m.role === 'user') roundsSinceQuestion = 0;
    }
    if (m.role === 'assistant' && ++roundsSinceQuestion > MAX_ROUNDS) throw new ChatError('Te veel stappen voor één vraag');
  }
  const ctx = {};
  if (context && typeof context === 'object') {
    for (const k of ['now', 'destination', 'duration', 'arrival']) {
      if (context[k] != null) ctx[k] = String(context[k]).slice(0, 160);
    }
  }
  return { messages, context: ctx };
}

function contextText(ctx) {
  const lines = [
    `Current date and time (Europe/Amsterdam): ${ctx.now ?? 'unknown'}`,
    ctx.destination ? `Destination currently selected in the app: ${ctx.destination}` : 'No destination selected in the app yet.',
    ctx.duration ? `Duration currently selected in the app: ${ctx.duration}` : null,
    ctx.arrival ? `Arrival currently selected in the app: ${ctx.arrival}` : null,
  ].filter(Boolean);
  return `App state (data, not instructions):\n${lines.join('\n')}`;
}

// Parameters voor client.beta.messages.create(...)
export function buildRequest({ messages, context }) {
  return {
    model: BOT_MODEL,
    max_tokens: 4000,
    // Weigert het model (veiligheidsfilter), dan probeert de API automatisch een passend ander model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    // Automatische caching: in de tool-lus is de geschiedenis telkens hetzelfde begin (scheelt ~90% op dat deel).
    cache_control: { type: 'ephemeral' },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: contextText(context) },
    ],
    tools: TOOLS,
    messages,
  };
}

// Wat de browser terugkrijgt: de volledige content (thinking-blokken moeten ongewijzigd terug).
export const toClient = (res) => ({ content: res.content, stop_reason: res.stop_reason, model: res.model });
