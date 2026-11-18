// Eenvoudige schijfcache + gebundelde momentopname (offline terugval).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, '..', 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshot');

export async function readCache(name, maxAgeMs) {
  try {
    const raw = JSON.parse(await readFile(path.join(CACHE_DIR, `${name}.json`), 'utf8'));
    if (maxAgeMs && Date.now() - raw.savedAt > maxAgeMs) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function writeCache(name, data) {
  await mkdir(CACHE_DIR, { recursive: true });
  const payload = { savedAt: Date.now(), data };
  await writeFile(path.join(CACHE_DIR, `${name}.json`), JSON.stringify(payload));
  return payload;
}

export async function readSnapshot(name) {
  try {
    return JSON.parse(await readFile(path.join(SNAPSHOT_DIR, `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export async function writeSnapshot(name, data) {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const payload = { savedAt: Date.now(), data };
  await writeFile(path.join(SNAPSHOT_DIR, `${name}.json`), JSON.stringify(payload));
  return payload;
}

// Haal live op; bij fout: verse cache -> oude cache -> snapshot.
// fast: gebruik meteen wat lokaal beschikbaar is (oude cache of snapshot) en sla live ophalen over;
//       de server ververst dan op de achtergrond. Zo start een gehoste versie binnen een paar seconden.
// Geeft { data, origin: 'live'|'cache'|'snapshot', savedAt } terug.
export async function loadWithFallback(name, ttlMs, fetchLive, { forceLive = false, fast = false } = {}) {
  if (!forceLive) {
    const fresh = await readCache(name, ttlMs);
    if (fresh) return { data: fresh.data, origin: 'cache', savedAt: fresh.savedAt };
  }
  if (fast && !forceLive) {
    const stale = await readCache(name, 0);
    if (stale) return { data: stale.data, origin: 'cache', savedAt: stale.savedAt, stale: true };
    const snap = await readSnapshot(name);
    if (snap) return { data: snap.data, origin: 'snapshot', savedAt: snap.savedAt, stale: true };
  }
  try {
    const data = await fetchLive();
    const saved = await writeCache(name, data);
    return { data, origin: 'live', savedAt: saved.savedAt };
  } catch (err) {
    console.warn(`[data] ${name}: live ophalen mislukt (${err.message}), terugval gebruikt`);
    const stale = await readCache(name, 0);
    if (stale) return { data: stale.data, origin: 'cache', savedAt: stale.savedAt, error: err.message };
    const snap = await readSnapshot(name);
    if (snap) return { data: snap.data, origin: 'snapshot', savedAt: snap.savedAt, error: err.message };
    throw err;
  }
}

export async function fetchJson(url, { timeoutMs = 30000, headers = {}, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    body,
    headers: { 'User-Agent': 'ParkSmart-prototype/0.1', Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} voor ${new URL(url).host}`);
  const text = await res.text();
  if (!text) throw new Error(`Lege respons van ${new URL(url).host}`);
  return JSON.parse(text);
}
