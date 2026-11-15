// Living Himalaya LOT 3: fetches the summit weather of ONE peak at a time
// through the shared request runtime, with a sessionStorage cache (30 min per
// peak, forecast and model metadata). Changing peak aborts the previous
// requests; a late response for another peak is ignored.
import { createRequestRuntime } from '../core/runtime/request-runtime.js';
import { RUNTIME_STATE } from '../core/runtime/runtime-states.js';
import { forecastUrl, modelMetaUrl, WEATHER_CACHE_TTL_MS } from './summit-weather.js';

const STALE_TTL_MS = 6 * 60 * 60_000;

/** Cache adapter for the request runtime backed by sessionStorage (JSON values). */
export function createSessionStorageCache({ storage = globalThis.sessionStorage, prefix = 'lumi-himalaya:', now = () => Date.now() } = {}) {
  const read = (key) => {
    try {
      const raw = storage?.getItem(prefix + key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  };
  const write = (record) => {
    try { storage?.setItem(prefix + record.key, JSON.stringify(record)); } catch (_) { /* quota/private mode: no cache */ }
    return record;
  };
  return Object.freeze({
    get: async (key) => read(key),
    set: async (key, value, meta = {}) => write({
      key, value, storedAt: now(), sourceTime: meta.sourceTime || null, etag: meta.etag || null,
      lastModified: meta.lastModified || null, responseType: meta.responseType || 'json',
    }),
    touch: async (key) => read(key),
  });
}

/**
 * @param {object} o
 * @param {(state:object)=>void} o.onChange  called with { peakId, status, forecast, meta, fromCache, cacheAgeMs, stale }
 * @param {object} [o.runtime]               injected for tests
 */
export function createWeatherClient({ onChange, runtime = createRequestRuntime({ cache: createSessionStorageCache() }) }) {
  let controller = null;
  let token = 0;
  let current = null;

  function publish(state) {
    current = state;
    onChange(state);
  }

  async function load(peak) {
    controller?.abort(new DOMException('Summit changed', 'AbortError'));
    controller = new AbortController();
    const mine = ++token;
    const { signal } = controller;
    publish({ peakId: peak.id, status: 'loading' });
    const common = { responseType: 'json', ttl: WEATHER_CACHE_TTL_MS, staleTtl: STALE_TTL_MS, retries: 1, timeout: 12_000, signal };
    try {
      const [forecast, meta] = await Promise.all([
        runtime.fetchResource({ ...common, key: `himalaya-weather:${peak.id}`, url: forecastUrl(peak) }),
        runtime.fetchResource({ ...common, key: `himalaya-weather-meta:${peak.id}`, url: modelMetaUrl() }),
      ]);
      if (mine !== token || signal.aborted) return; // a newer summit owns the panel
      const fromCache = forecast.meta?.cache === 'hit' || forecast.meta?.cache === 'stale-if-error';
      publish({
        peakId: peak.id, status: 'ready', forecast: forecast.data, meta: meta.data,
        fromCache, cacheAgeMs: fromCache ? forecast.meta?.cacheAgeMs || 0 : 0,
        stale: forecast.state === RUNTIME_STATE.STALE,
      });
    } catch (error) {
      if (mine !== token || signal.aborted) return;
      publish({ peakId: peak.id, status: 'unavailable', error: error?.message || String(error) });
    }
  }

  return Object.freeze({
    load,
    clear() {
      controller?.abort(new DOMException('Summit cleared', 'AbortError'));
      token += 1;
      current = null;
    },
    get state() { return current; },
    dispose() {
      controller?.abort(new DOMException('Living Himalaya disposed', 'AbortError'));
      token += 1;
      runtime.abortAll?.();
    },
  });
}
