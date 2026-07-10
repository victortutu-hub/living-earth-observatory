import { persistentCache, classifyCacheRecord } from './persistent-cache.js';
import { RUNTIME_STATE, createRuntimeMeta } from './runtime-states.js';
import { runtimeControl } from './runtime-control.js';

export class RuntimeRequestError extends Error {
  constructor(message, { cause = null, runtime = null } = {}) {
    super(message, { cause });
    this.name = 'RuntimeRequestError';
    this.runtime = runtime;
  }
}

function abortError(reason = 'Aborted') {
  return new DOMException(String(reason), 'AbortError');
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function canUseConditionalHeaders(url, enabled) {
  if (enabled) return true;
  if (typeof location === 'undefined') return false;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch (_) {
    return false;
  }
}

function retryAfterMs(response) {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function linkedController(signal, timeout) {
  const controller = new AbortController();
  let timer = 0;
  const onAbort = () => controller.abort(signal.reason || abortError());
  if (signal?.aborted) controller.abort(signal.reason || abortError());
  else signal?.addEventListener('abort', onAbort, { once: true });
  if (timeout > 0) {
    timer = setTimeout(() => controller.abort(new DOMException(`Timeout after ${timeout}ms`, 'TimeoutError')), timeout);
  }
  return {
    controller,
    dispose() {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || abortError());
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason || abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function parseResponse(response, responseType) {
  switch (responseType) {
    case 'text': return response.text();
    case 'blob': return response.blob();
    case 'arrayBuffer': return response.arrayBuffer();
    case 'json':
    default: return response.json();
  }
}

function sourceTimeFromData(data, selector) {
  if (typeof selector !== 'function') return null;
  try { return selector(data) || null; } catch (_) { return null; }
}

export function createRequestRuntime({ cache = persistentCache, onDiagnostic = null, control = runtimeControl } = {}) {
  const inflight = new Map();
  const diagnostics = new Map();
  const diagnosticListeners = new Set();

  function emitDiagnostic(record) {
    const normalized = Object.freeze({
      ...record,
      observedAt: new Date().toISOString(),
    });
    diagnostics.set(record.key, normalized);
    onDiagnostic?.(normalized);
    diagnosticListeners.forEach((listener) => {
      try { listener(normalized); } catch (error) {
        console.warn('[Luminomorphism] Request diagnostic listener failed.', error);
      }
    });
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('lumi:request-diagnostic', { detail: normalized }));
    }
  }

  async function fetchResource({
    key,
    url,
    responseType = 'json',
    ttl = 60_000,
    staleTtl = 24 * 60 * 60_000,
    timeout = 12_000,
    retries = 2,
    backoffBase = 450,
    signal = null,
    fetchOptions = {},
    forceRefresh = false,
    sourceTimeSelector = null,
  }) {
    if (!key) throw new TypeError('fetchResource requires a stable cache key.');
    if (!url) throw new TypeError('fetchResource requires a URL.');
    if (signal?.aborted) throw signal.reason || abortError();

    const inflightKey = `${key}:${responseType}:${url}`;
    const cached = await cache.get(key);
    if (signal?.aborted) throw signal.reason || abortError();
    const cacheState = classifyCacheRecord(cached, { ttl, staleTtl });
    if (!forceRefresh && cacheState.freshness === 'fresh') {
      const result = {
        data: cached.value,
        state: RUNTIME_STATE.LIVE,
        meta: createRuntimeMeta({
          phase: 'ready', freshness: 'fresh', cache: 'hit', cacheAgeMs: cacheState.ageMs,
          attempts: 0, updated: new Date(cached.storedAt).toISOString(), sourceTime: cached.sourceTime,
          networkState: 'cached',
        }),
      };
      emitDiagnostic({ key, url, responseType, state: result.state, ...result.meta });
      return result;
    }

    const existing = inflight.get(inflightKey);
    if (existing) return subscribeToInflight(existing, signal);

    const internalController = new AbortController();
    const activeSignal = internalController.signal;
    const entry = {
      key,
      url,
      responseType,
      controller: internalController,
      promise: null,
      subscribers: new Set(),
      settled: false,
    };

    const operation = (async () => {
      const started = performance.now?.() ?? Date.now();
      let lastError = null;
      let attempts = 0;
      for (let attempt = 0; attempt <= retries; attempt++) {
        attempts = attempt + 1;
        if (activeSignal?.aborted) throw activeSignal.reason || abortError();
        const { conditionalHeaders = false, ...networkOptions } = fetchOptions;
        const headers = new Headers(networkOptions.headers || {});
        if (canUseConditionalHeaders(url, conditionalHeaders)) {
          if (cached?.etag) headers.set('If-None-Match', cached.etag);
          if (cached?.lastModified) headers.set('If-Modified-Since', cached.lastModified);
        }
        const linked = linkedController(activeSignal, timeout);
        try {
          control.assertNetworkAllowed(url);
          const response = await fetch(url, { ...networkOptions, headers, signal: linked.controller.signal });
          if (response.status === 304 && cached) {
            const touched = await cache.touch(key);
            const latencyMs = Math.round((performance.now?.() ?? Date.now()) - started);
            const result = {
              data: cached.value,
              state: RUNTIME_STATE.LIVE,
              meta: createRuntimeMeta({
                phase: 'ready', freshness: 'revalidated', cache: 'validated', cacheAgeMs: 0,
                latencyMs, attempts, updated: new Date(touched?.storedAt || Date.now()).toISOString(),
                sourceTime: cached.sourceTime, networkState: 'not-modified',
              }),
            };
            emitDiagnostic({ key, url, responseType, state: result.state, ...result.meta });
            return result;
          }
          if (!response.ok) {
            const error = new Error(`HTTP ${response.status} for ${url}`);
            error.status = response.status;
            error.retryAfter = retryAfterMs(response);
            throw error;
          }
          const data = await parseResponse(response, responseType);
          const sourceTime = sourceTimeFromData(data, sourceTimeSelector);
          const stored = await cache.set(key, data, {
            sourceTime,
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified'),
            responseType,
          });
          const latencyMs = Math.round((performance.now?.() ?? Date.now()) - started);
          const result = {
            data,
            state: RUNTIME_STATE.LIVE,
            meta: createRuntimeMeta({
              phase: 'ready', freshness: 'fresh', cache: cached ? 'refresh' : 'miss', cacheAgeMs: 0,
              latencyMs, attempts, updated: new Date(stored.storedAt).toISOString(), sourceTime,
              networkState: 'online',
            }),
          };
          emitDiagnostic({ key, url, responseType, state: result.state, ...result.meta });
          return result;
        } catch (error) {
          lastError = error;
          if (isAbortError(error) || linked.controller.signal.aborted && activeSignal?.aborted) throw error;
          const status = error?.status;
          const retryable = !error?.simulatedOffline && (!status || isRetryableStatus(status));
          if (!retryable || attempt >= retries) break;
          const exponential = backoffBase * 2 ** attempt;
          const jitter = exponential * (0.15 + Math.random() * 0.2);
          await wait(error.retryAfter ?? exponential + jitter, activeSignal);
        } finally {
          linked.dispose();
        }
      }

      const networkState = lastError?.simulatedOffline ? 'simulated-offline' : 'offline';
      if (cached && cacheState.usable) {
        const latencyMs = Math.round((performance.now?.() ?? Date.now()) - started);
        const result = {
          data: cached.value,
          state: RUNTIME_STATE.STALE,
          meta: createRuntimeMeta({
            phase: 'ready', freshness: cacheState.freshness, cache: 'stale-if-error',
            cacheAgeMs: cacheState.ageMs, latencyMs, attempts,
            updated: new Date(cached.storedAt).toISOString(), sourceTime: cached.sourceTime,
            networkState, error: lastError?.message || String(lastError),
          }),
        };
        emitDiagnostic({ key, url, responseType, state: result.state, ...result.meta });
        return result;
      }

      const runtime = createRuntimeMeta({
        phase: 'error', freshness: 'miss', cache: 'miss', attempts,
        networkState, error: lastError?.message || String(lastError),
      });
      emitDiagnostic({ key, url, responseType, state: RUNTIME_STATE.OFFLINE, ...runtime });
      throw new RuntimeRequestError(`Resource unavailable: ${url}`, { cause: lastError, runtime });
    })();

    entry.promise = operation.finally(() => {
      entry.settled = true;
      if (inflight.get(inflightKey) === entry) inflight.delete(inflightKey);
    });
    inflight.set(inflightKey, entry);
    return subscribeToInflight(entry, signal);
  }

  function subscribeToInflight(entry, signal = null) {
    if (signal?.aborted) return Promise.reject(signal.reason || abortError());

    const subscriber = Symbol('runtime-request-subscriber');
    entry.subscribers.add(subscriber);

    return new Promise((resolve, reject) => {
      let completed = false;

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        entry.subscribers.delete(subscriber);
      };

      const finish = (callback, value) => {
        if (completed) return;
        completed = true;
        cleanup();
        callback(value);
      };

      const onAbort = () => {
        const reason = signal?.reason || abortError();
        finish(reject, reason);
        if (!entry.settled && entry.subscribers.size === 0) {
          entry.controller.abort(abortError('all-subscribers-aborted'));
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        (result) => finish(resolve, result),
        (error) => finish(reject, error),
      );
    });
  }

  function abortAll(reason = 'runtime-disposed') {
    inflight.forEach((entry) => entry.controller?.abort(abortError(reason)));
    inflight.clear();
  }

  function getDiagnostics() {
    return Object.fromEntries([...diagnostics.entries()].map(([key, value]) => [key, { ...value }]));
  }

  function getInflightSnapshot() {
    return [...inflight.values()].map(({ key, url, responseType, subscribers }) => ({
      key,
      url,
      responseType,
      subscribers: subscribers.size,
    }));
  }

  function subscribeDiagnostics(listener) {
    if (typeof listener !== 'function') return () => {};
    diagnosticListeners.add(listener);
    return () => diagnosticListeners.delete(listener);
  }

  function replaceDiagnostics(records = {}, { emit = false } = {}) {
    diagnostics.clear();
    const entries = Array.isArray(records)
      ? records.map((record) => [record?.key, record])
      : Object.entries(records || {});
    let count = 0;
    for (const [key, record] of entries) {
      if (!key || !record || typeof record !== 'object') continue;
      const normalized = Object.freeze({ ...record, key: record.key || key });
      diagnostics.set(normalized.key, normalized);
      count++;
      if (emit) {
        diagnosticListeners.forEach((listener) => {
          try { listener(normalized); } catch (_) { /* diagnostic replay remains isolated */ }
        });
      }
    }
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('lumi:request-diagnostics-replaced', {
        detail: { count, replay: true },
      }));
    }
    return count;
  }

  function clearDiagnostics() {
    diagnostics.clear();
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('lumi:request-diagnostics-replaced', {
        detail: { count: 0, replay: false },
      }));
    }
  }

  return Object.freeze({
    fetchResource,
    abortAll,
    getDiagnostics,
    getInflightSnapshot,
    subscribeDiagnostics,
    replaceDiagnostics,
    clearDiagnostics,
    cache,
    control,
  });
}

export const requestRuntime = createRequestRuntime();
