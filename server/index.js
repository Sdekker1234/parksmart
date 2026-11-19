// ParkSmart server: API + statische frontend. Start met `npm start`.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY, SEARCH, LANDMARKS } from './config.js';
import { loadRdw, rdwStatus, uuidByArea } from './rdw.js';
import { loadSpdp, spdpStatus } from './spdp.js';
import { loadOsm, osmStatus } from './osm.js';
import { loadPlaces, placesStatus } from './places.js';
import { search, zonesForMap } from './search.js';
import { suggest, searchOne, reverseLabel } from './geocode.js';
import { parseArrival } from './pricing.js';
import { aiStatus, parseQuery, advise } from './ai.js';
import Anthropic from '@anthropic-ai/sdk';
import { buildRequest, validateChat, toClient, ChatError } from '../shared/bot.js';
import { inBBox } from './geo.js';
import { fetchJson } from './cache.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const LEAFLET = path.join(here, '..', 'node_modules', 'leaflet', 'dist');
const PORT = Number(process.env.PORT) || 3000;
// Op een hostingplatform (Render zet RENDER=true) moet de server op alle interfaces luisteren.
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');

// ---------- Data ----------
let loading = null;
let refreshing = null;
async function loadData(opts = {}) {
  const r = await loadRdw(opts);
  const extra = [...uuidByArea().entries()].filter(([id]) => id.startsWith(`${CITY.areaManagerId}_`)).map(([, u]) => u);
  const [s, o, pl] = await Promise.all([loadSpdp(extra, opts), loadOsm(opts), loadPlaces(opts)]);
  return [r, s, o, pl].some((x) => x.stale);
}
// Live verversen op de achtergrond (na een snelle start of periodiek).
function refreshLive(reason) {
  refreshing ??= loadData({ forceLive: true })
    .then(() => console.log(`[data] live ververst (${reason})`))
    .catch((e) => console.warn(`[data] verversen mislukt: ${e.message}`))
    .finally(() => (refreshing = null));
  return refreshing;
}
function ensureData() {
  // Snel starten met cache/momentopname; daarna live ophalen zonder dat bezoekers hoeven te wachten.
  loading ??= loadData({ fast: true })
    .then((stale) => {
      if (stale) refreshLive('na start');
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}
setInterval(() => {
  loadData().catch((e) => console.warn('[data] verversen mislukt:', e.message));
}, 6 * 3600e3).unref();

// ---------- Limieten (belangrijk als de link gedeeld wordt) ----------
// Per IP: algemene API-limiet en een aparte, strengere limiet voor AI. Plus een daglimiet voor AI in totaal.
const LIMITS = {
  apiPer10Min: Number(process.env.API_LIMIT_PER_10_MIN) || 600,
  aiPerHour: Number(process.env.AI_LIMIT_PER_HOUR) || 30,
  aiPerDay: Number(process.env.AI_DAILY_LIMIT) || 200,
  botPerHour: Number(process.env.BOT_LIMIT_PER_HOUR) || 60, // één vraag aan de assistent = meestal 2-3 aanroepen
};
let botClient = null;
const buckets = new Map(); // key -> { start, count }
function hit(key, windowMs, max) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  b.count++;
  return b.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.start > 24 * 3600e3) buckets.delete(k);
}, 3600e3).unref();
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'onbekend';
// Mag dit verzoek Claude gebruiken? Zo niet, dan valt de app terug op de ingebouwde regels.
function aiAllowed(req) {
  const ip = clientIp(req);
  const day = new Date().toISOString().slice(0, 10);
  return hit(`ai:${ip}`, 3600e3, LIMITS.aiPerHour) && hit(`ai-day:${day}`, 24 * 3600e3, LIMITS.aiPerDay);
}

// Nederlandse wandkloktijd als UTC-Date
function nowNL() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Amsterdam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute));
}

// ---------- HTTP-hulpjes ----------
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow', // testversie: niet in zoekmachines
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isBuf ? body : JSON.stringify(body));
}
const bad = (res, msg) => send(res, 400, { error: msg });

async function readBody(req, limit = 32 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Body te groot');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

async function serveStatic(res, root, rel) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) return send(res, 403, { error: 'Verboden' });
  try {
    const st = await stat(file);
    const target = st.isDirectory() ? path.join(file, 'index.html') : file;
    const body = await readFile(target);
    const ext = path.extname(target);
    send(res, 200, body, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': root === LEAFLET ? 'public, max-age=86400' : 'no-cache',
    });
  } catch {
    send(res, 404, { error: 'Niet gevonden' });
  }
}

const routeCache = new Map();

// ---------- Routes ----------
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const q = url.searchParams;

  if (p.startsWith('/api/') && !hit(`api:${clientIp(req)}`, 10 * 60e3, LIMITS.apiPer10Min)) {
    return send(res, 429, { error: 'rate_limited', message: 'Even rustig aan: te veel verzoeken. Probeer het over een paar minuten opnieuw.' });
  }

  if (p === '/api/status') {
    await ensureData().catch(() => {});
    const n = nowNL();
    return send(res, 200, {
      city: { name: CITY.name, shortName: CITY.shortName, center: CITY.center, bbox: CITY.bbox },
      landmarks: LANDMARKS.map(({ id, label, lat, lon }) => ({ id, label, lat, lon })),
      now: n.toISOString().slice(0, 16),
      ai: aiStatus(),
      data: { rdw: rdwStatus(), spdp: spdpStatus(), osm: osmStatus(), places: placesStatus() },
    });
  }

  if (p === '/api/zones') {
    await ensureData();
    const date = q.get('date') || nowNL().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(res, 'Ongeldige datum');
    return send(res, 200, { zones: zonesForMap(date.replace(/-/g, '')) }, { 'Cache-Control': 'public, max-age=600' });
  }

  if (p === '/api/search') {
    await ensureData();
    const lat = Number(q.get('lat'));
    const lon = Number(q.get('lon'));
    const durationMin = Math.round(Number(q.get('duration')));
    const arrival = parseArrival(q.get('arrival')) ?? nowNL();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return bad(res, 'lat/lon ontbreekt');
    if (!inBBox({ lat, lon }, CITY.bbox)) {
      return send(res, 422, { error: 'outside', message: `ParkSmart werkt voorlopig alleen in ${CITY.shortName}.` });
    }
    if (!Number.isFinite(durationMin) || durationMin < 15 || durationMin > 7 * 1440) return bad(res, 'Duur moet tussen 15 min en 7 dagen liggen');
    const options = await search({ dest: { lat, lon }, arrival, durationMin });
    return send(res, 200, {
      destination: { lat, lon },
      arrival: arrival.toISOString().slice(0, 16),
      durationMin,
      radius: SEARCH,
      generatedAt: new Date().toISOString(),
      options,
    });
  }

  if (p === '/api/geocode/suggest') {
    await ensureData().catch(() => {});
    const term = (q.get('q') || '').trim();
    if (term.length < 2) return send(res, 200, { results: [] });
    return send(res, 200, { results: await suggest(term.slice(0, 120)) });
  }

  if (p === '/api/geocode/search') {
    await ensureData().catch(() => {});
    const term = (q.get('q') || '').trim();
    if (term.length < 2) return send(res, 200, { result: null });
    return send(res, 200, { result: await searchOne(term.slice(0, 120)) });
  }

  if (p === '/api/geocode/reverse') {
    const lat = Number(q.get('lat'));
    const lon = Number(q.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return bad(res, 'lat/lon ontbreekt');
    return send(res, 200, { label: await reverseLabel(lat, lon), inCity: inBBox({ lat, lon }, CITY.bbox) });
  }

  if (p === '/api/route') {
    const parse = (s) => String(s || '').split(',').map(Number);
    const [la1, lo1] = parse(q.get('from'));
    const [la2, lo2] = parse(q.get('to'));
    if (![la1, lo1, la2, lo2].every(Number.isFinite)) return bad(res, 'from/to ontbreekt');
    const key = [la1, lo1, la2, lo2].map((x) => x.toFixed(5)).join(',');
    if (!routeCache.has(key)) {
      try {
        const j = await fetchJson(
          `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${lo1},${la1};${lo2},${la2}?overview=full&geometries=geojson`,
          { timeoutMs: 12000 },
        );
        const r = j.routes?.[0];
        if (!r) throw new Error('Geen route');
        routeCache.set(key, {
          distance: Math.round(r.distance),
          // OSRM-voetprofiel rekent met ~5 km/u; we gebruiken 4,8 km/u om consistent te blijven met de schatting.
          minutes: Math.max(1, Math.round(r.distance / 80)),
          coordinates: r.geometry.coordinates.map(([x, y]) => [y, x]),
        });
        if (routeCache.size > 500) routeCache.delete(routeCache.keys().next().value);
      } catch (err) {
        return send(res, 502, { error: 'Looproute niet beschikbaar', detail: err.message });
      }
    }
    return send(res, 200, routeCache.get(key));
  }

  if (p === '/api/ai/parse' && req.method === 'POST') {
    await ensureData().catch(() => {});
    const body = await readBody(req);
    if (!body.text || typeof body.text !== 'string') return bad(res, 'text ontbreekt');
    const parsed = await parseQuery(body.text, nowNL(), { allowAi: () => aiAllowed(req) });
    let place = null;
    if (parsed.destination && !(parsed.topic === 'off_topic' && parsed.destination_guess)) place = await searchOne(parsed.destination);
    return send(res, 200, { ...parsed, place, placeInCity: place ? inBBox(place, CITY.bbox) : null });
  }

  if (p === '/api/ai/advice' && req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.options)) return bad(res, 'options ontbreekt');
    const dp = body.destination_place;
    const ctx = {
      destination: String(body.destination || '').slice(0, 120),
      // Bedrijf als bestemming (uit OpenStreetMap): de AI kan dan zeggen of het open is bij aankomst.
      destination_place:
        dp && typeof dp === 'object'
          ? {
              name: String(dp.name || '').slice(0, 100),
              kind: String(dp.kind || '').slice(0, 60),
              address: String(dp.address || '').slice(0, 100),
              opening_hours_osm: String(dp.hours || '').slice(0, 200) || null,
            }
          : null,
      arrival: String(body.arrival || '').slice(0, 20),
      duration_label: String(body.duration_label || '').slice(0, 40),
      filters: body.filters ?? {},
      options: body.options.slice(0, 8).map((o) => ({
        id: String(o.id),
        name: String(o.name).slice(0, 80),
        kind: String(o.kind || '').slice(0, 40),
        total: typeof o.total === 'number' ? o.total : null,
        per_hour: typeof o.per_hour === 'number' ? o.per_hour : null,
        walk_min: Number(o.walk_min) || 0,
        walk_m: Number(o.walk_m) || 0,
        shuttle: Boolean(o.shuttle),
        source_trust: String(o.source_trust || ''),
        live: o.live ? { vacant: Number(o.live.vacant), capacity: Number(o.live.capacity) } : null,
        notes: (o.notes ?? []).slice(0, 3).map((n) => String(n).slice(0, 160)),
        warnings: (o.warnings ?? []).slice(0, 2).map((n) => String(n).slice(0, 160)),
      })),
    };
    return send(res, 200, await advise(ctx, { allowAi: () => aiAllowed(req) }));
  }

  // ParkSmart-assistent: één Claude-aanroep per verzoek; de tools draaien in de browser.
  if (p === '/api/bot' && req.method === 'POST') {
    if (!aiStatus().enabled) return send(res, 503, { error: 'not_configured', message: 'Er is geen API-sleutel ingesteld.' });
    const ip = clientIp(req);
    const day = new Date().toISOString().slice(0, 10);
    if (!hit(`bot:${ip}`, 3600e3, LIMITS.botPerHour) || !hit(`ai-day:${day}`, 24 * 3600e3, LIMITS.aiPerDay * 3)) {
      return send(res, 429, { error: 'rate_limited', message: 'De assistent heeft even pauze nodig. Probeer het later opnieuw.' });
    }
    let chat;
    try {
      chat = validateChat(await readBody(req, 300 * 1024));
    } catch (err) {
      return send(res, 400, { error: 'invalid', message: err instanceof ChatError ? err.message : 'Ongeldige aanvraag' });
    }
    botClient ??= new Anthropic({ maxRetries: 1, timeout: 60_000 });
    try {
      return send(res, 200, toClient(await botClient.beta.messages.create(buildRequest(chat))));
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return send(res, 503, { error: 'not_configured', message: 'De API-sleutel werkt niet.' });
      if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'rate_limited', message: 'Het is even druk. Probeer het zo opnieuw.' });
      if (err instanceof Anthropic.BadRequestError) return send(res, 400, { error: 'invalid', message: 'Dit gesprek kan ik niet verwerken; start een nieuw gesprek.' });
      console.warn('[bot]', err.message);
      return send(res, 502, { error: 'upstream', message: 'De AI is nu niet bereikbaar.' });
    }
  }

  if (p.startsWith('/api/')) return send(res, 404, { error: 'Onbekende API-route' });
  if (p.startsWith('/vendor/leaflet/')) return serveStatic(res, LEAFLET, p.slice('/vendor/leaflet/'.length));
  return serveStatic(res, PUBLIC, decodeURIComponent(p));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[server]', err);
    if (!res.headersSent) send(res, 500, { error: 'Er ging iets mis op de server', detail: err.message });
  });
});

server.listen(PORT, HOST, () => {
  const ai = aiStatus();
  console.log(`\n  ParkSmart draait op http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  AI: ${ai.enabled ? `aan (${ai.model})` : `uit (${ai.reason}), regels als terugval`}\n`);
  ensureData()
    .then(() => {
      const s = { rdw: rdwStatus(), spdp: spdpStatus(), osm: osmStatus(), places: placesStatus() };
      for (const [k, v] of Object.entries(s)) console.log(`  data ${k.padEnd(4)} ${v.origin}${v.savedAt ? ` (${new Date(v.savedAt).toLocaleString('nl-NL')})` : ''}`);
    })
    .catch((err) => console.error('  data laden mislukt:', err.message));
});
