import { atlasStatus } from './status-store.js?v=sourceInspectorV4';
import { requestRuntime } from './runtime/request-runtime.js';
import { persistentCache } from './runtime/persistent-cache.js';
import { runtimeDisplayValue } from './runtime/runtime-states.js';

const EONET_DEFAULT_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100';

function latestEonetTimestamp(json) {
  let latest = null;
  for (const event of Array.isArray(json?.events) ? json.events : []) {
    const geometry = Array.isArray(event.geometry) ? event.geometry[event.geometry.length - 1] : null;
    const date = geometry?.date;
    if (date && (!latest || new Date(date) > new Date(latest))) latest = date;
  }
  return latest;
}

export function publishRuntimeStatus(key, result) {
  atlasStatus.setStatus(key, runtimeDisplayValue(result.state), result.state, {
    ...result.meta,
    updated: result.meta.updated,
    sourceTime: result.meta.sourceTime,
  });
}

export function publishRuntimeError(key, error) {
  if (error?.name === 'AbortError') return;
  atlasStatus.setStatus(key, 'OFFLINE', 'offline', {
    ...(error?.runtime || {}),
    phase: 'error',
    error: error?.message || String(error),
    updated: new Date().toISOString(),
  });
}

export async function initializeDataBroker() {
  const backend = await persistentCache.ready();
  atlasStatus.setStatus('cache', backend === 'memory' ? 'MEMORY ONLY' : backend.toUpperCase(), backend === 'memory' ? 'fallback' : 'live', {
    phase: 'ready',
    cache: backend,
    updated: new Date().toISOString(),
  });
  return backend;
}

export async function fetchJsonResource(key, url, options = {}) {
  return requestRuntime.fetchResource({
    key,
    url,
    responseType: 'json',
    fetchOptions: options.fetchOptions || { mode: 'cors', priority: 'low' },
    ...options,
  });
}

export async function fetchTextResource(key, url, options = {}) {
  return requestRuntime.fetchResource({
    key,
    url,
    responseType: 'text',
    fetchOptions: options.fetchOptions || { mode: 'cors', priority: 'low' },
    ...options,
  });
}

export async function fetchBlobResource(key, url, options = {}) {
  return requestRuntime.fetchResource({
    key,
    url,
    responseType: 'blob',
    fetchOptions: options.fetchOptions || { mode: 'cors', priority: 'low' },
    ...options,
  });
}

export async function fetchEonetResult(url = EONET_DEFAULT_URL, options = {}) {
  try {
    const result = await fetchJsonResource('nasa-eonet-open-events-v3', url, {
      ttl: 60_000,
      staleTtl: 24 * 60 * 60_000,
      timeout: 14_000,
      retries: 2,
      backoffBase: 550,
      sourceTimeSelector: latestEonetTimestamp,
      ...options,
    });
    publishRuntimeStatus('eonet', result);
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    atlasStatus.setStatus('eonet', 'OFFLINE', 'offline', {
      ...(error.runtime || {}),
      phase: 'error',
      error: error.message,
      updated: new Date().toISOString(),
    });
    throw error;
  }
}

export async function fetchEonet(url = EONET_DEFAULT_URL, options = {}) {
  return (await fetchEonetResult(url, options)).data;
}

// Backward-compatible uncached helpers for future adapters that do not yet declare a resource policy.
export async function request(url, options = {}, timeout = 12_000) {
  const result = await requestRuntime.fetchResource({
    key: `volatile:${url}`,
    url,
    responseType: 'blob',
    ttl: 0,
    staleTtl: 0,
    timeout,
    retries: 1,
    forceRefresh: true,
    fetchOptions: options,
  });
  return new Response(result.data);
}

export async function fetchJson(url, options = {}, timeout = 12_000) {
  return (await fetchJsonResource(`json:${url}`, url, {
    ttl: 0, staleTtl: 0, timeout, retries: 1, forceRefresh: true, fetchOptions: options,
  })).data;
}

export async function fetchText(url, options = {}, timeout = 12_000) {
  return (await fetchTextResource(`text:${url}`, url, {
    ttl: 0, staleTtl: 0, timeout, retries: 1, forceRefresh: true, fetchOptions: options,
  })).data;
}

export const dataBroker = Object.freeze({
  initialize: initializeDataBroker,
  request,
  fetchJson,
  fetchText,
  fetchJsonResource,
  fetchTextResource,
  fetchBlobResource,
  publishRuntimeStatus,
  publishRuntimeError,
  fetchEonet,
  fetchEonetResult,
  cache: persistentCache,
  runtime: requestRuntime,
});
