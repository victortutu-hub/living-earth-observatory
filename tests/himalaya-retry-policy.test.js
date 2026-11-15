// Living Himalaya — page-wide retry policy: exponential backoff (2 s, 4 s),
// at most 3 failed attempts per resource per visit, no loop after that. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestRuntime } from '../src/core/runtime/request-runtime.js';
import { BACKOFF_MS, MAX_FAILED_ATTEMPTS, RetryBudgetExhaustedError, createAttemptLedger, createGuardedRuntime } from '../src/himalaya/request-guard.js';
import { createWeatherClient } from '../src/himalaya/weather-client.js';
import { getHimalayaPeak } from '../src/config/himalaya-peaks.js';

const memoryCache = () => {
  const map = new Map();
  return { get: async (k) => map.get(k) || null, set: async (k, v) => { const r = { key: k, value: v, storedAt: Date.now() }; map.set(k, r); return r; }, touch: async (k) => map.get(k) || null };
};

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('request guard', () => {
  it('waits 2 s then 4 s, stops after 3 failed attempts, and never touches the network again in this visit', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response('down', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const ledger = createAttemptLedger();
    const runtime = createGuardedRuntime({ runtime: createRequestRuntime({ cache: memoryCache() }), ledger });
    const call = () => runtime.fetchResource({ key: 'tile:9/1/1', url: 'https://x/tile.png', responseType: 'blob', ttl: 0, staleTtl: 0, retries: 5 });
    const first = call().catch((e) => e);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // after 2 s
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3); // after 4 s more
    expect((await first).name).toBe('RuntimeRequestError');
    // Later calls in the same visit: refused immediately, no request, no timer.
    for (let i = 0; i < 5; i++) await expect(call()).rejects.toBeInstanceOf(RetryBudgetExhaustedError);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_FAILED_ATTEMPTS);
    expect(vi.getTimerCount()).toBe(0);
    expect(ledger.snapshot()).toEqual({ 'tile:9/1/1': 3 });
    expect(BACKOFF_MS.slice(0, 2)).toEqual([2000, 4000]);
  });

  it('does not retry non-retryable statuses and does not count aborted requests', async () => {
    const fetchMock = vi.fn(async () => new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const ledger = createAttemptLedger();
    const runtime = createGuardedRuntime({ runtime: createRequestRuntime({ cache: memoryCache() }), ledger, sleep: async () => {} });
    await expect(runtime.fetchResource({ key: 'a', url: 'https://x/a', ttl: 0, staleTtl: 0 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ledger.failures('a')).toBe(1);
    vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))));
    const controller = new AbortController();
    const pending = runtime.fetchResource({ key: 'b', url: 'https://x/b', ttl: 0, staleTtl: 0, signal: controller.signal });
    controller.abort(new DOMException('Summit changed', 'AbortError'));
    await expect(pending).rejects.toThrow('Summit changed');
    expect(ledger.failures('b')).toBe(0);
  });

  it('weather under permanent failure: at most 3 requests per resource, then "temporarily unavailable" with no loop', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    const ledger = createAttemptLedger();
    const states = [];
    const client = createWeatherClient({ onChange: (s) => states.push(s), runtime: createGuardedRuntime({ runtime: createRequestRuntime({ cache: memoryCache() }), ledger }) });
    const everest = getHimalayaPeak('everest');
    const load = client.load(everest);
    await vi.advanceTimersByTimeAsync(10_000);
    await load;
    for (let i = 0; i < 4; i++) { await client.load(everest); await vi.advanceTimersByTimeAsync(10_000); } // user re-selects the summit
    await vi.advanceTimersByTimeAsync(120_000);
    // 2 resources (forecast + model metadata) x 3 attempts at most.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(states.at(-1).status).toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });
});
