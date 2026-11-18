// Dunne laag rond de ParkSmart-API. In de statische versie (GitHub Pages) draait alles in de browser
// via local-api.js; met de Node-server praten we met /api/...
const STATIC = Boolean(window.PARKSMART_STATIC);

async function req(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* lege of geen JSON-respons */
  }
  if (!res.ok) {
    const err = new Error(body?.message || body?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null)).toString();

const serverApi = {
  status: () => req('/api/status'),
  zones: (date) => req(`/api/zones?${qs({ date })}`),
  search: (p, signal) => req(`/api/search?${qs(p)}`, { signal }),
  suggest: (q, signal) => req(`/api/geocode/suggest?${qs({ q })}`, { signal }),
  geocode: (q) => req(`/api/geocode/search?${qs({ q })}`),
  reverse: (lat, lon) => req(`/api/geocode/reverse?${qs({ lat, lon })}`),
  route: (from, to) => req(`/api/route?${qs({ from: `${from.lat},${from.lon}`, to: `${to.lat},${to.lon}` })}`),
  aiParse: (text) => req('/api/ai/parse', { method: 'POST', body: JSON.stringify({ text }) }),
  advice: (payload, signal) => req('/api/ai/advice', { method: 'POST', body: JSON.stringify(payload), signal }),
};

let local = null;
const localApi = () => (local ??= import('./local-api.js').then((m) => m.localApi));

export const api = Object.fromEntries(
  Object.keys(serverApi).map((k) => [k, async (...args) => (STATIC ? (await localApi())[k](...args) : serverApi[k](...args))]),
);
export const isStatic = STATIC;
