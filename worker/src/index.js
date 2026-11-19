// ParkSmart-assistent: Cloudflare Worker die de Claude-aanroep doet voor de statische site.
// De API-sleutel staat als geheim in Cloudflare (wrangler secret put ANTHROPIC_API_KEY) en komt
// nooit in de browser. Model, systeemprompt en tools liggen vast in shared/bot.js.
import Anthropic from '@anthropic-ai/sdk';
import { buildRequest, validateChat, toClient, ChatError } from '../../shared/bot.js';

// Eenvoudige limieten per Worker-instantie. De echte rem is een uitgavenlimiet in de Anthropic Console.
const buckets = new Map();
function allow(key, windowMs, max) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    if (buckets.size > 5000) buckets.clear();
    return true;
  }
  return ++b.count <= max;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health') return json(200, { ok: true, configured: Boolean(env.ANTHROPIC_API_KEY) });
    if (url.pathname !== '/chat' || request.method !== 'POST') return json(404, { error: 'not_found' });
    if (!allowed.includes(origin)) return json(403, { error: 'origin_not_allowed' });
    if (!env.ANTHROPIC_API_KEY) return json(503, { error: 'not_configured', message: 'De assistent heeft nog geen API-sleutel.' });

    const ip = request.headers.get('CF-Connecting-IP') || 'onbekend';
    const day = new Date().toISOString().slice(0, 10);
    if (!allow(`ip:${ip}`, 3600e3, Number(env.LIMIT_PER_HOUR) || 60) || !allow(`day:${day}`, 86400e3, Number(env.LIMIT_PER_DAY) || 400)) {
      return json(429, { error: 'rate_limited', message: 'De assistent heeft even pauze nodig. Probeer het later opnieuw.' });
    }

    let chat;
    try {
      chat = validateChat(await request.json());
    } catch (err) {
      return json(400, { error: 'invalid', message: err instanceof ChatError ? err.message : 'Ongeldige aanvraag' });
    }

    const client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}), // alleen voor lokaal testen
      maxRetries: 1,
      timeout: 60_000,
    });
    try {
      const res = await client.beta.messages.create(buildRequest(chat));
      return json(200, toClient(res));
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        return json(503, { error: 'not_configured', message: 'De API-sleutel van de assistent werkt niet.' });
      }
      if (err instanceof Anthropic.RateLimitError) return json(429, { error: 'rate_limited', message: 'Het is even druk. Probeer het zo opnieuw.' });
      if (err instanceof Anthropic.BadRequestError) return json(400, { error: 'invalid', message: 'Dit gesprek kan ik niet verwerken; start een nieuw gesprek.' });
      if (err instanceof Anthropic.APIError) return json(502, { error: 'upstream', message: 'De AI is nu niet bereikbaar.' });
      return json(502, { error: 'upstream', message: 'De AI is nu niet bereikbaar.' });
    }
  },
};
