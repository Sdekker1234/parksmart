// Browserversie van server/cache.js voor de statische site (GitHub Pages).
// Het buildscript kopieert dit bestand als engine/cache.js; de andere modules merken geen verschil.
// Data komt uit data/*.json naast de site; die bestanden ververst een GitHub Action.

const DATA = new URL('../data/', import.meta.url);

export async function readCache() {
  return null;
}
export async function writeCache(_name, data) {
  return { savedAt: Date.now(), data };
}
export async function readSnapshot(name) {
  try {
    const res = await fetch(new URL(`${name}.json`, DATA), { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
export async function writeSnapshot(_name, data) {
  return { savedAt: Date.now(), data };
}

// Geen live ophalen in de browser: de meegeleverde data is de bron (origin 'static').
export async function loadWithFallback(name) {
  const snap = await readSnapshot(name);
  if (!snap) throw new Error(`Data "${name}" niet gevonden`);
  return { data: snap.data, origin: 'static', savedAt: snap.savedAt };
}

export async function fetchJson(url, { timeoutMs = 30000, headers = {}, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    body,
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} voor ${new URL(url).host}`);
  return res.json();
}
