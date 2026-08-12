// feed-adapter.js
//
// Contract unic pentru sursele de tip "feed de evenimente" (GDACS, FIRMS,
// USGS, GDACS fallback, etc.). In loc ca fiecare sursa sa isi scrie propriul
// fetch + timeout + retry + cache + status (cum face acum fiecare provider din
// src/earth/*), fiecare devine o mica configurare care declara DOAR:
//   - de unde ia datele (resolveUrl),
//   - cum transforma raspunsul brut in evenimente interne (normalize).
//
// Restul - reincercari, cache persistent, fallback pe cache vechi, status
// uniform in panoul de sanatate - se mostenesc din runtime-ul deja existent
// (acelasi drum pe care il merge EONET prin data-broker), o singura data,
// testat o singura data.
//
// Interfata returnata este identica cu providerii actuali:
//   { fetchEvents(filters) -> events[], getStatus() -> {state, message}, dispose() }
// deci adoptarea e un drop-in: schimbi un singur import in app-services.js.

import { requestRuntime } from './runtime/request-runtime.js';
import { publishRuntimeStatus, publishRuntimeError } from './data-broker.js';
import { RUNTIME_STATE } from './runtime/runtime-states.js';

function eventTime(event) {
  const raw = event?.geometry?.[0]?.date;
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

// Modelarea comuna dupa fetch. Toti adaptorii Earth normalizeaza catre acelasi
// model intern de eveniment, deci filtrarea pe interval / categorie, sortarea
// dupa data si limitarea numarului pot trai o singura data, aici.
export function shapeEvents(events, { days = 20, category = 'all', maxEvents = 250 } = {}) {
  const cutoff = Date.now() - Math.max(1, Number(days) || 20) * 86_400_000;
  return (events || [])
    .filter(Boolean)
    .filter((event) => eventTime(event) >= cutoff)
    .filter((event) => !category || category === 'all' || event.categories?.[0]?.id === category)
    .sort((a, b) => eventTime(b) - eventTime(a))
    .slice(0, maxEvents);
}

export function defineFeedAdapter(config) {
  const {
    key,                       // cheie de cache stabila (obligatoriu)
    statusKey = null,          // cheia din atlasStatus / source-registry (optional)
    label = 'source',          // eticheta pentru mesajele de status
    unit = 'events',           // "220 hotspots", "12 fallback alerts", etc.
    ttl = 60_000,              // cat timp raspunsul e considerat proaspat
    staleTtl = 24 * 60 * 60_000, // cat timp cache-ul vechi mai poate salva situatia offline
    timeout = 15_000,
    retries = 2,
    maxEvents = 250,
    fetchOptions = { mode: 'cors', priority: 'low' },
    resolveUrl,                // (filters) => string           (obligatoriu)
    normalize,                 // (payload, ctx) => rawEvents[]  (obligatoriu)
    preflight = null,          // (filters) => void | throws  (ex: proxy necesar)
    shape = shapeEvents,       // (events, filters) => events[]
    readPayloadStatus = (payload) => payload?.proxyStatus || null,
    isPayloadError = (payload) => payload?.proxyStatus === 'error',
    payloadErrorMessage = (payload) => payload?.proxyError || `${label} upstream error`,
  } = config;

  if (typeof resolveUrl !== 'function') throw new TypeError('defineFeedAdapter requires resolveUrl(filters).');
  if (typeof normalize !== 'function') throw new TypeError('defineFeedAdapter requires normalize(payload, ctx).');

  const controllers = new Set();
  let disposed = false;
  let lastCount = 0;
  let lastUpdated = null;
  let lastError = null;
  let lastPayloadStatus = null;
  let lastRuntimeState = null;

  async function fetchEvents(filters = {}) {
    if (disposed) throw new DOMException(`${label} adapter disposed`, 'AbortError');
    lastError = null;
    const controller = new AbortController();
    controllers.add(controller);
    try {
      if (preflight) preflight(filters); // poate arunca (ex: proxy dezactivat in runtime public)

      const url = resolveUrl(filters);
      const result = await requestRuntime.fetchResource({
        key,
        url,
        responseType: 'json',
        ttl,
        staleTtl,
        timeout,
        retries,
        signal: controller.signal,
        fetchOptions,
      });

      const payload = result.data;
      if (isPayloadError(payload)) throw new Error(payloadErrorMessage(payload));

      lastPayloadStatus = readPayloadStatus(payload);
      lastRuntimeState = result.state;

      const raw = normalize(payload, { filters, url });
      const events = shape(raw, { maxEvents, ...filters });

      lastCount = events.length;
      lastUpdated = Date.now();
      if (statusKey) publishRuntimeStatus(statusKey, result);
      return events;
    } catch (error) {
      lastError = error;
      lastCount = 0;
      if (statusKey && error?.name !== 'AbortError') publishRuntimeError(statusKey, error);
      throw error;
    } finally {
      controllers.delete(controller);
    }
  }

  function getStatus() {
    if (lastError) {
      // erorile "proxy necesar" sunt o stare de repaus, nu o defectiune.
      return {
        state: lastError.proxyRequired ? 'off' : 'error',
        message: `${label}: ${lastError.message || 'network error'}`,
      };
    }
    if (!lastUpdated) return { state: 'off', message: `${label}: standby` };
    const time = new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const stale = (lastPayloadStatus === 'stale-cache' || lastRuntimeState === RUNTIME_STATE.STALE)
      ? ' (cached, live fetch failed)'
      : '';
    return { state: 'on', message: `${label}: ${lastCount} ${unit}, updated ${time}${stale}` };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const controller of controllers) controller.abort();
    controllers.clear();
  }

  return { fetchEvents, getStatus, dispose };
}
