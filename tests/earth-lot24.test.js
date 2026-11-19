// LOT 24 — Living Earth surface: no more "all or nothing". A new request per attempt (request
// runtime, no persistent cache), independent levels in one bounded pool, background rounds until
// the deadline (late tiles upgrade the surface), everything stopped by the signal; runtime grace.
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIBS_TILE_POLICY, attemptTimeoutMs, classifyTileError, loadTileWithRetry } from '../src/earth/gibs-tiles.js';
import { loadGibsTileBitmap } from '../src/earth/gibs-tile-loader.js';
import { SURFACE_TILE_POLICY, createPriorityLimiter, describeSurfaceLevel, loadBlueMarbleSurfaceTexture, surfaceStatus } from '../src/earth/gibs-surface.js';
import { BLACK_MARBLE_TILE_POLICY, loadBlackMarbleTexture } from '../src/earth/gibs-night-lights.js';
import { NON_PERSISTENT_CACHE } from '../src/core/sky/sky-assets.js';
import { createRequestRuntime } from '../src/core/runtime/request-runtime.js';
import { SURFACE_GRACE_MS, earthRuntimeState } from '../src/earth/earth-runtime-state.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Texture { constructor(source) { this.source = source; this.userData = {}; } }
const THREE = { CanvasTexture: Texture, SRGBColorSpace: 'srgb' };
const renderer = { capabilities: { getMaxAnisotropy: () => 16 } };
const tile = (url) => ({ url, close() {} });
const canvases = () => {
  const create = (width, height) => ({ width, height, draws: [], getContext() { const self = this; return { drawImage: (...a) => self.draws.push(a), imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }; } });
  return { create };
};
const fast = { tileTimeoutMs: 40, retries: 2, backoffMs: [1, 1], backgroundRetryMs: 15, backgroundTimeoutMs: 60, deadlineMs: 1500, concurrency: 8, levelConcurrency: 6 };
const hang = (signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
const isZ = (url, z) => url.includes(`/500m/${z}/`);
const quiet = { log: () => {} };

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('LOT 24: per-tile attempts are new, abortable requests', () => {
  it('every attempt gets its own signal; a timeout aborts that attempt before the next one starts', async () => {
    const signals = [];
    const loadImage = vi.fn((url, { signal }) => { signals.push(signal); return signals.length < 3 ? hang(signal) : Promise.resolve('tile'); });
    const attempts = [];
    await expect(loadTileWithRetry(loadImage, 'u', { timeoutMs: 20, retries: 2, backoffMs: [5, 5], onAttempt: (a) => attempts.push(a) })).resolves.toBe('tile');
    expect(loadImage).toHaveBeenCalledTimes(3);
    expect(new Set(signals).size).toBe(3);
    expect(signals[0].aborted && signals[1].aborted).toBe(true);
    expect(signals[0].reason.name).toBe('TimeoutError');
    expect(signals[2].aborted).toBe(false);
    expect(attempts).toEqual([{ attempt: 0, ok: false, reason: 'timeout' }, { attempt: 1, ok: false, reason: 'timeout' }, { attempt: 2, ok: true, reason: null }]);
  });

  it('backoff between attempts (1 s, then 3 s) and the default policy', async () => {
    expect(GIBS_TILE_POLICY).toEqual({ timeoutMs: [20_000, 30_000, 45_000], retries: 2, backoffMs: [1000, 3000] });
    vi.useFakeTimers();
    const calls = [];
    const loadImage = vi.fn(() => { calls.push(Date.now()); return Promise.reject(Object.assign(new Error('HTTP 503'), { status: 503 })); });
    const result = loadTileWithRetry(loadImage, 'u', { timeoutMs: 20_000, retries: 2, backoffMs: [1000, 3000] });
    const settled = expect(result).rejects.toThrow('HTTP 503');
    await vi.advanceTimersByTimeAsync(5000);
    await settled;
    expect(calls.map((t) => t - calls[0])).toEqual([0, 1000, 4000]);
  });

  it('timeouts rise per attempt: 20 s / 30 s / 45 s (the last value repeats; a number still works)', async () => {
    expect([0, 1, 2, 3].map((a) => attemptTimeoutMs(GIBS_TILE_POLICY.timeoutMs, a))).toEqual([20_000, 30_000, 45_000, 45_000]);
    expect(attemptTimeoutMs(15_000, 2)).toBe(15_000);
    vi.useFakeTimers();
    const timeouts = [];
    const loadImage = vi.fn((url, { signal, timeoutMs }) => { timeouts.push(timeoutMs); return hang(signal); });
    const result = loadTileWithRetry(loadImage, 'u', { ...GIBS_TILE_POLICY });
    const settled = expect(result).rejects.toThrow('GIBS tile timed out after 45000 ms: u');
    await vi.advanceTimersByTimeAsync(20_000 + 1000 + 30_000 + 3000 + 44_999);
    expect(loadImage).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(timeouts).toEqual([20_000, 30_000, 45_000]);
  });

  it('failure reasons: timeout / http / decode / abort / network', () => {
    expect(classifyTileError(Object.assign(new Error('x'), { tileReason: 'timeout' }))).toBe('timeout');
    expect(classifyTileError(new Error('Resource unavailable', { cause: Object.assign(new Error('HTTP 500'), { status: 500 }) }))).toBe('http');
    expect(classifyTileError(Object.assign(new Error('bad'), { tileReason: 'decode' }))).toBe('decode');
    expect(classifyTileError(new DOMException('a', 'AbortError'))).toBe('abort');
    expect(classifyTileError(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('an external abort is never retried', async () => {
    const controller = new AbortController();
    const loadImage = vi.fn((url, { signal }) => hang(signal));
    const pending = loadTileWithRetry(loadImage, 'u', { timeoutMs: 10_000, retries: 2, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadImage).toHaveBeenCalledTimes(1);
  });
});

describe('LOT 24: tiles through the request runtime, without the persistent cache', () => {
  it('a retry is a NEW fetch (the timed-out one is aborted), not a wait on the old request', async () => {
    const fetches = [];
    vi.stubGlobal('fetch', vi.fn((url, init) => {
      fetches.push(init.signal);
      if (fetches.length === 1) return hang(init.signal);
      return Promise.resolve(new Response(new Blob(['png']), { status: 200 }));
    }));
    const runtime = createRequestRuntime({ cache: NON_PERSISTENT_CACHE });
    const decode = vi.fn(async (blob) => ({ bitmapOf: blob.size }));
    const load = (url, opts) => loadGibsTileBitmap(url, { ...opts, runtime, decode });
    await expect(loadTileWithRetry(load, 'https://gibs.earthdata.nasa.gov/t.jpeg', { timeoutMs: 30, retries: 1 })).resolves.toEqual({ bitmapOf: 3 });
    expect(fetches).toHaveLength(2);
    expect(fetches[0].aborted).toBe(true);
    expect(fetches[1].aborted).toBe(false);
  });

  it('runtime options: no retries / timeout inside the runtime, ttl 0, a unique key per attempt; decode failure = "decode"', async () => {
    const calls = [];
    const runtime = { fetchResource: async (options) => { calls.push(options); return { data: 'blob' }; } };
    await loadGibsTileBitmap('https://gibs/x.jpeg', { runtime, decode: async () => 'bmp' });
    await loadGibsTileBitmap('https://gibs/x.jpeg', { runtime, decode: async () => 'bmp' });
    expect(calls[0]).toMatchObject({ url: 'https://gibs/x.jpeg', responseType: 'blob', ttl: 0, staleTtl: 0, timeout: 0, retries: 0 });
    expect(calls[0].key).not.toBe(calls[1].key);
    await expect(loadGibsTileBitmap('https://gibs/x.jpeg', { runtime, decode: async () => { throw new Error('EncodingError'); } }))
      .rejects.toMatchObject({ tileReason: 'decode' });
  });

  it('tiles never reach the persistent cache (NON_PERSISTENT_CACHE, as GLO-30 / sky)', async () => {
    expect(text('src/earth/gibs-tile-loader.js')).toContain('createRequestRuntime({ cache: NON_PERSISTENT_CACHE })');
    await NON_PERSISTENT_CACHE.set('gibs-tile:x', 'data');
    expect(await NON_PERSISTENT_CACHE.get('gibs-tile:x')).toBeNull();
  });

  it('the landing page loads no new module: gibs-tiles.js still imports nothing', () => {
    expect(text('src/earth/gibs-tiles.js')).not.toMatch(/^import /m);
    expect(text('src/gateway/assets/earth-texture-loader.js')).not.toContain('gibs-tile-loader');
  });
});

describe('LOT 24: Blue Marble surface — independent levels, late tiles, deadline, dispose', () => {
  it('policy: 8 requests in flight (6 max per level), 20 / 30 / 45 s, 2 retries (1 s / 3 s), background every 10 s (45 s attempts) until 3 min', () => {
    expect(SURFACE_TILE_POLICY).toEqual({ concurrency: 8, levelConcurrency: 6, tileTimeoutMs: [20_000, 30_000, 45_000], retries: 2, backoffMs: [1000, 3000], backgroundRetryMs: 10_000, backgroundTimeoutMs: 45_000, deadlineMs: 180_000 });
  });

  it('"20 s on every request" is no longer a regression: the longer retry gets every tile, no "unavailable"', async () => {
    // Scaled: every request answers after 50 ms; attempts time out at 40 / 60 / 90 ms (20 / 30 / 45 s).
    const loadImage = (url, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(tile(url)), 50);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    const onUnavailable = vi.fn();
    const result = await loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: canvases().create, policy: { ...fast, tileTimeoutMs: [40, 60, 90] }, onUnavailable, ...quiet });
    expect(result.z).toBe(3);
    expect(onUnavailable).not.toHaveBeenCalled();
    const z3 = result.stats.find((s) => s.z === 3);
    expect(z3).toMatchObject({ arrived: 50, failed: 0, requests: 100, retried: 50 });
    expect(z3.reasons.timeout).toBe(50);
  });

  it('z3 keeps loading while EVERY z2 tile struggles (a level never takes all the slots)', async () => {
    const loadImage = (url, { signal }) => (isZ(url, 2) ? hang(signal) : Promise.resolve(tile(url)));
    const levels = [];
    const result = await loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: canvases().create, policy: { ...fast, tileTimeoutMs: 400, deadlineMs: 60_000 }, onLevel: (t, info) => levels.push(info.z), ...quiet });
    expect(levels).toEqual([3]);
    expect(result.z).toBe(3);
  });

  it('a slow but alive source (every request 80 ms, attempts 40 ms): the longer background attempts get it', async () => {
    const loadImage = (url, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(tile(url)), 80);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    const events = [];
    const result = await loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: canvases().create, policy: { ...fast, backgroundTimeoutMs: 200, deadlineMs: 5000 }, onUnavailable: () => events.push('unavailable'), onLevel: (t, info) => events.push(info.z), ...quiet });
    expect(events[0]).toBe('unavailable');
    expect(result.z).toBe(3);
  });

  it('one stuck z2 tile + one stuck z3 tile: the retries get them, the surface ends on z3 (not "unavailable")', async () => {
    const seen = new Map();
    const loadImage = (url, { signal }) => {
      const n = (seen.get(url) || 0) + 1; seen.set(url, n);
      if (n === 1 && (url.endsWith('/500m/2/1/2.jpeg') || url.endsWith('/500m/3/2/4.jpeg'))) return hang(signal);
      return Promise.resolve(tile(url));
    };
    const onUnavailable = vi.fn();
    const levels = [];
    const result = await loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: canvases().create, policy: fast, onUnavailable, onLevel: (t, info) => levels.push(info.z), ...quiet });
    expect(result.z).toBe(3);
    expect(levels.at(-1)).toBe(3);
    expect(onUnavailable).not.toHaveBeenCalled();
    const z3 = result.stats.find((s) => s.z === 3);
    expect(z3).toMatchObject({ tiles: 50, arrived: 50, failed: 0 });
    expect(z3.retried).toBeGreaterThanOrEqual(1);
    expect(z3.reasons.timeout).toBeGreaterThanOrEqual(1);
  });

  it('z3 does not wait for z2: a z2 tile hanging until the deadline does not stop z3; z2 is then dropped', async () => {
    const loadImage = (url, { signal }) => (url.endsWith('/500m/2/0/0.jpeg') ? hang(signal) : Promise.resolve(tile(url)));
    const levels = [];
    const started = Date.now();
    const result = await loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: canvases().create, policy: { ...fast, tileTimeoutMs: 400, deadlineMs: 60_000 }, onLevel: (t, info) => levels.push(info), ...quiet });
    expect(levels.map((l) => [l.z, l.final])).toEqual([[3, true]]);
    expect(result.z).toBe(3);
    expect(Date.now() - started).toBeLessThan(5000); // z2 superseded and aborted, not waited for
    expect(result.stats.find((s) => s.z === 2).state).toBe('superseded');
  });

  it('"35 s on every tile": unavailable first, then back to GIBS when the tiles start to come', async () => {
    const t0 = Date.now();
    const loadImage = (url, { signal }) => (Date.now() - t0 < 250 ? hang(signal) : Promise.resolve(tile(url)));
    const events = [];
    const result = await loadBlueMarbleSurfaceTexture({
      THREE, renderer, loadImage, createCanvas: canvases().create, policy: { ...fast, retries: 0, backoffMs: [] },
      onUnavailable: (e) => events.push(['unavailable', e.retrying]), onLevel: (t, info) => events.push(['level', info.z]), ...quiet,
    });
    expect(events[0]).toEqual(['unavailable', true]);
    expect(events.at(-1)).toEqual(['level', 3]);
    expect(result.z).toBe(3);
  });

  it('a tile that never arrives: background rounds stop at the deadline; the level fails with its first reason', async () => {
    const loadImage = (url) => (isZ(url, 3) && url.endsWith('/3/4.jpeg') ? Promise.reject(Object.assign(new Error('HTTP 503'), { status: 503 })) : Promise.resolve(tile(url)));
    const lines = [];
    const result = await loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: canvases().create, policy: { ...fast, deadlineMs: 300 }, log: (l) => lines.push(l) });
    expect(result.z).toBe(2);
    expect(result.failures).toEqual([`z3: HTTP 503`]);
    const z3 = result.stats.find((s) => s.z === 3);
    expect(z3).toMatchObject({ state: 'failed', failed: 1, arrived: 49 });
    expect(z3.reasons.http).toBeGreaterThanOrEqual(3);
    expect(lines.some((l) => /^\[Earth\] NASA GIBS Blue Marble z2: 15 tiles requested, 15 arrived, .* shown after/.test(l))).toBe(true);
    expect(lines.some((l) => /z3: 50 tiles requested, 49 arrived, .* 1 failing; failed attempts: http \d+ — failed/.test(l))).toBe(true);
  });

  it('every level failing until the deadline -> rejects (the bundled texture stays)', async () => {
    const loadImage = () => Promise.reject(new Error('offline'));
    await expect(loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: canvases().create, policy: { ...fast, deadlineMs: 120 }, ...quiet }))
      .rejects.toThrow('NASA GIBS Blue Marble WMTS unavailable — z2: offline; z3: offline');
  });

  it('bounded pool across both levels (peak <= concurrency), z2 tiles first', async () => {
    let active = 0; let peak = 0; const order = [];
    const loadImage = async (url) => { active++; peak = Math.max(peak, active); order.push(isZ(url, 2) ? 2 : 3); await sleep(2); active--; return tile(url); };
    await loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: canvases().create, policy: { ...fast, concurrency: 6 }, ...quiet });
    expect(peak).toBeLessThanOrEqual(6);
    expect(order.slice(0, 15).every((z) => z === 2)).toBe(true);
    const limiter = createPriorityLimiter(1);
    const ran = [];
    await Promise.all([limiter.run(0, async () => ran.push('a')), limiter.run(0, async () => ran.push('low')), limiter.run(5, async () => ran.push('high'))]);
    expect(ran).toEqual(['a', 'high', 'low']);
    const grouped = createPriorityLimiter(3, { groupLimit: 2 });
    const started = [];
    const block = () => new Promise(() => {});
    grouped.run(9, () => { started.push('z2-a'); return block(); }, 2);
    grouped.run(9, () => { started.push('z2-b'); return block(); }, 2);
    grouped.run(9, () => { started.push('z2-c'); return block(); }, 2);
    grouped.run(0, () => { started.push('z3-a'); return block(); }, 3);
    await sleep(5);
    expect(started).toEqual(['z2-a', 'z2-b', 'z3-a']); // the third z2 job waits: z3 keeps a slot
  });

  it('dispose (signal): everything stops, no request and no level after the abort (DESTROYED_IS_TERMINAL)', async () => {
    const controller = new AbortController();
    let calls = 0;
    const loadImage = (url, { signal }) => { calls++; return hang(signal); };
    const onLevel = vi.fn();
    const pending = loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: canvases().create, policy: fast, signal: controller.signal, onLevel, ...quiet });
    await sleep(20);
    controller.abort(new DOMException('disposed', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const after = calls;
    await sleep(200);
    expect(calls).toBe(after);
    expect(onLevel).not.toHaveBeenCalled();
  });

  it('console / snapshot line per level and the "retrying in the background" status', () => {
    expect(describeSurfaceLevel({ z: 3, tiles: 50, arrived: 50, requests: 52, retried: 2, failed: 0, reasons: { timeout: 2, http: 0, decode: 0, abort: 0, network: 0 }, state: 'complete', shownMs: 12_340 }))
      .toBe('[Earth] NASA GIBS Blue Marble z3: 50 tiles requested, 50 arrived, 52 requests (2 retries), 0 failing; failed attempts: timeout 2 — shown after 12.3 s');
    expect(surfaceStatus({ kind: 'unavailable', retrying: true }).message).toBe('Surface: bundled fallback texture active — NASA GIBS WMTS unavailable; retrying in the background');
    expect(surfaceStatus({ kind: 'unavailable' }).message).toBe('Surface: bundled fallback texture active — NASA GIBS WMTS unavailable');
  });
});

describe('LOT 24: Black Marble and snow & ice on the same per-tile path (still all-or-nothing)', () => {
  it('Black Marble: new request per attempt, 20 / 30 / 45 s, 2 retries with backoff; one failing attempt is recovered', async () => {
    expect(BLACK_MARBLE_TILE_POLICY).toEqual({ concurrency: 8, tileTimeoutMs: [20_000, 30_000, 45_000], retries: 2, backoffMs: [1000, 3000] });
    const seen = new Set();
    const loadImage = vi.fn(async (url) => { if (!seen.has(url) && url.endsWith('/2/1/2.png')) { seen.add(url); throw new Error('reset'); } return tile(url); });
    const texture = await loadBlackMarbleTexture({ THREE, renderer, loadImage, createCanvas: canvases().create, policy: { concurrency: 8, tileTimeoutMs: 1000, retries: 2, backoffMs: [1] } });
    expect(texture.userData.gibsTiles).toBe(15);
    expect(loadImage).toHaveBeenCalledTimes(16);
    const source = text('src/earth/gibs-night-lights.js');
    expect(source).toContain('loadImage = loadGibsTileBitmap, // LOT 24');
  });

  it('snow & ice: the same loader and policy', () => {
    const source = text('src/earth/gibs-snow-ice.js');
    expect(source).toContain('loadImage = loadGibsTileBitmap, // LOT 24: a new request per attempt');
    expect(source).toContain('retries: GIBS_TILE_POLICY.retries, backoffMs: GIBS_TILE_POLICY.backoffMs, loadImage });');
  });
});

describe('LOT 24: earth-layers ownership and runtime grace', () => {
  it('the surface and Black Marble loads take the layers signal; dispose aborts it and clears the watchdogs', () => {
    const layers = text('src/earth/earth-layers.js');
    expect(layers).toContain('signal: gibsController.signal, // LOT 24: stops on dispose');
    expect(layers).toContain('loadBlackMarbleTexture({ THREE, renderer, signal: gibsController.signal })');
    expect(layers).toContain("gibsController.abort(new DOMException('earth layers disposed', 'AbortError'));");
    expect(layers).toContain('clearTimeout(surfaceWatchdog);');
    expect(text('src/earth/app-visual-foundation.js')).toContain('earthLayers.dispose?.(); // LOT 24');
  });

  it(`surface grace ${SURFACE_GRACE_MS} ms: no core-timeout flicker when z2 arrives at 45 s; bundled texture after 60 s -> FALLBACK; back on GIBS -> LIVE`, () => {
    const base = { relief: 'ktx2', sun: 'astronomy-engine', eonet: { state: 'live' }, sky: 'MAP + STARS' };
    expect(earthRuntimeState({ ...base, surface: { kind: 'still-loading' }, elapsedMs: 44_000 })).toMatchObject({ state: 'live', pending: ['surface'] });
    expect(earthRuntimeState({ ...base, surface: { kind: 'preview' }, elapsedMs: 45_000 })).toMatchObject({ state: 'live', pending: [] });
    expect(earthRuntimeState({ ...base, surface: { kind: 'still-loading' }, elapsedMs: 61_000 })).toMatchObject({ state: 'fallback', reasons: ['core-timeout (surface)'] });
    expect(earthRuntimeState({ ...base, surface: { kind: 'unavailable' }, elapsedMs: 59_000 })).toMatchObject({ state: 'live' });
    expect(earthRuntimeState({ ...base, surface: { kind: 'unavailable' }, elapsedMs: 61_000 })).toMatchObject({ state: 'fallback', reasons: ['surface-fallback'] });
    expect(earthRuntimeState({ ...base, surface: { kind: 'preview' }, elapsedMs: 150_000 })).toMatchObject({ state: 'live', reasons: [] }); // late tiles (D)
  });
});
