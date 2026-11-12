import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestRuntime, serviceWorkerCachedAt } from '../src/core/runtime/request-runtime.js';
import { eonetTransportLabel } from '../src/earth/eonet-data.js';

function memoryCache() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.get(key) || null; },
    async set(key, value, meta = {}) {
      const record = { value, storedAt: Date.now(), ...meta };
      store.set(key, record);
      return record;
    },
    async touch(key) {
      const record = store.get(key);
      if (record) record.storedAt = Date.now();
      return record || null;
    },
  };
}

const control = { assertNetworkAllowed() {} };
const ttl = 60_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('service-worker cache header', () => {
  it('ignores a missing, empty, zero or non-numeric header', () => {
    expect(serviceWorkerCachedAt(new Response('{}'))).toBeNull();
    expect(serviceWorkerCachedAt(new Response('{}', { headers: { 'x-lea-cached-at': '' } }))).toBeNull();
    expect(serviceWorkerCachedAt(new Response('{}', { headers: { 'x-lea-cached-at': '0' } }))).toBeNull();
    expect(serviceWorkerCachedAt(new Response('{}', { headers: { 'x-lea-cached-at': 'abc' } }))).toBeNull();
    expect(serviceWorkerCachedAt(new Response('{}', { headers: { 'x-lea-cached-at': '1794400000000' } }))).toBe(1794400000000);
  });

  it('labels a plain network response as a miss, not service-worker-cache', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"ok":true}', { status: 200 }));
    const runtime = createRequestRuntime({ cache: memoryCache(), control });
    const result = await runtime.fetchResource({ key: 'plain', url: 'https://example.test/a', ttl });
    expect(result.meta).toMatchObject({ cache: 'miss', freshness: 'fresh', networkState: 'online', cacheAgeMs: 0 });
    expect(eonetTransportLabel(result.meta)).toBe('live / fresh');
  });

  it('labels a refresh of an expired entry as refresh, with no age', async () => {
    const cache = memoryCache();
    cache.store.set('expired', { value: { old: true }, storedAt: Date.now() - 10 * ttl });
    vi.stubGlobal('fetch', async () => new Response('{"ok":true}', { status: 200 }));
    const runtime = createRequestRuntime({ cache, control });
    const result = await runtime.fetchResource({ key: 'expired', url: 'https://example.test/b', ttl, staleTtl: 20 * ttl });
    expect(result.meta).toMatchObject({ cache: 'refresh', networkState: 'online', cacheAgeMs: 0 });
  });

  it('keeps the service-worker label and real age when the header is valid', async () => {
    const cachedAt = Date.now() - 5_000;
    vi.stubGlobal('fetch', async () => new Response('{"ok":true}', { status: 200, headers: { 'x-lea-cached-at': String(cachedAt) } }));
    const runtime = createRequestRuntime({ cache: memoryCache(), control });
    const result = await runtime.fetchResource({ key: 'sw', url: 'https://example.test/c', ttl });
    expect(result.meta.cache).toBe('service-worker-cache');
    expect(result.meta.networkState).toBe('cached');
    expect(result.meta.cacheAgeMs).toBeGreaterThanOrEqual(5_000);
    expect(result.meta.cacheAgeMs).toBeLessThan(60_000);
    expect(eonetTransportLabel(result.meta)).toBe('cached / fresh');
  });

  it('revalidation (304) without the header stays validated, not service-worker-cache', async () => {
    const cache = memoryCache();
    cache.store.set('revalidate', { value: { ok: true }, storedAt: Date.now() - 10 * ttl, etag: '"v1"' });
    const seen = [];
    vi.stubGlobal('fetch', async (_url, options) => {
      seen.push(options.headers.get('If-None-Match'));
      return new Response(null, { status: 304 });
    });
    const runtime = createRequestRuntime({ cache, control });
    const result = await runtime.fetchResource({
      key: 'revalidate', url: 'https://example.test/d', ttl, staleTtl: 20 * ttl,
      fetchOptions: { conditionalHeaders: true },
    });
    expect(seen).toEqual(['"v1"']);
    expect(result.meta).toMatchObject({ cache: 'validated', freshness: 'revalidated', networkState: 'not-modified', cacheAgeMs: 0 });
  });
});
