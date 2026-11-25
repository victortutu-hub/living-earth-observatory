// LOT 41 steps 2-4: regional Blue Marble NG detail (src/earth/gibs-regional-surface.js).
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from '../lib/three@0.185.1/build/three.module.js';
import {
  REGIONAL_BASE_TEXEL_KM, REGIONAL_LABEL, REGIONAL_POLICY, createRegionalSurface, describeRegionalStatus, injectRegionalSurface,
  regionalBaseLod, regionalLevelFor, regionalLevelGeometry, regionalProfile, regionalSlot, regionalWindowKey, selectRegionalView,
} from '../src/earth/gibs-regional-surface.js';
import { EARTH_RUNTIME_REASONS, earthRuntimeState } from '../src/earth/earth-runtime-state.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ALPS = { lat: 46.5, lon: 10 };
// A point of the Earth mesh frame (three.js SphereGeometry, radius 1) for lat / lon.
const unit = (lat, lon) => { const phi = (lon + 180) / 360 * 2 * Math.PI; const theta = (90 - lat) / 180 * Math.PI; return new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)); };
function view({ lat = ALPS.lat, lon = ALPS.lon, dist, pixelRatio = 1, touch = false, width = 1600, height = 900 }) {
  const cam = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  cam.position.copy(unit(lat, lon).multiplyScalar(dist)); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
  const col = (i) => new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, i).toArray();
  const profile = regionalProfile({ touch, pixelRatio });
  return selectRegionalView({ camera: cam.position.toArray(), forward: col(2).map((c) => -c), right: col(0), up: col(1), fovDeg: 45, aspect: width / height, heightPx: height, pixelRatio, maxLevel: profile.maxLevel, slots: profile.slots });
}

describe('LOT 41: levels and footprint', () => {
  it('texels: z3 base ~9.77 km; z4 3.91, z5 1.95, z6 0.98 km; the level is the coarsest texel <= the pixel footprint', () => {
    expect(REGIONAL_BASE_TEXEL_KM).toBeCloseTo(9.773, 3);
    expect([4, 5, 6].map((z) => +regionalLevelGeometry(z).texelKm.toFixed(2))).toEqual([3.91, 1.95, 0.98]);
    expect(regionalLevelFor(12, 6)).toBe(null); // z3 is enough
    expect(regionalLevelFor(7.3, 6)).toBe(4);
    expect(regionalLevelFor(3.2, 6)).toBe(5);
    expect(regionalLevelFor(1.6, 6)).toBe(6);
    expect(regionalLevelFor(1.6, 5)).toBe(5); // capped
    expect([4, 5, 6].map((z) => +regionalBaseLod(z).toFixed(3))).toEqual([1.322, 2.322, 3.322]);
  });

  it('profiles: desktop z5 (z6 at pixel ratio >= 2) with an 8 x 8 atlas; touch capped at z5 with 4 x 4; budgets', () => {
    expect(regionalProfile({ pixelRatio: 1 })).toMatchObject({ maxLevel: 5, slots: 8, concurrency: 6, lruTiles: 32 });
    expect(regionalProfile({ pixelRatio: 2 })).toMatchObject({ maxLevel: 6, slots: 8 });
    expect(regionalProfile({ touch: true, pixelRatio: 3 })).toMatchObject({ maxLevel: 5, slots: 4, concurrency: 4, lruTiles: 8 });
    // fixed GPU memory: 4096^2 (desktop) / 2048^2 (touch) RGBA8 + mip chain
    expect(Math.round(4096 * 4096 * 4 * 4 / 3 / 2 ** 20)).toBe(85);
    expect(Math.round(2048 * 2048 * 4 * 4 / 3 / 2 ** 20)).toBe(21);
  });
});

describe('LOT 41: tile selection for known views (1600 x 900)', () => {
  it('Alps at 3.1, pixel ratio 1: z5, a window of 8 x 4 tiles (the same as measured in the page), the 4 central tiles first', () => {
    const s = view({ dist: 3.1 });
    expect(s).toMatchObject({ active: true, level: 5, window: { x0: 17, y0: 3, w: 8, h: 4, columns: 40, rows: 20 } });
    expect(s.tiles).toHaveLength(31);
    // 10 E is 1 deg from the 9 E tile edge: the rays next to the centre fall on tiles 20 and 21 (rows 4 and 5).
    expect(s.tiles.slice(0, 4).map((t) => t.key).sort()).toEqual(['5/20/4', '5/20/5', '5/21/4', '5/21/5']);
    expect(Math.floor((ALPS.lon + 180) / 9)).toBe(21);
    expect(new Set(s.tiles.map((t) => t.key)).size).toBe(31);
    expect(regionalWindowKey(s)).toBe('5:17,3,8x4');
  });

  it('pixel ratio 2 -> z6 (window clipped to 8 x 8); touch -> z5 in 4 x 4; 4.5 -> z4', () => {
    expect(view({ dist: 3.1, pixelRatio: 2 })).toMatchObject({ level: 6, window: { w: 8, h: 8, columns: 80 } });
    const touch = view({ dist: 3.1, pixelRatio: 2, touch: true });
    expect(touch).toMatchObject({ level: 5, window: { w: 4, h: 4 } });
    expect(touch.tiles.length).toBeLessThanOrEqual(16);
    expect(view({ dist: 4.5 })).toMatchObject({ active: true, level: 4 });
  });

  it('nothing at distance >= 4.6 (6.4, 12) — the layer is not used at all', () => {
    for (const dist of [4.6, 6.4, 12]) expect(view({ dist })).toMatchObject({ active: false, reason: 'distance' });
  });

  it('slots stay distinct across the antimeridian (z4: 20 columns, not a multiple of 8)', () => {
    const window = { x0: 16, columns: 20 };
    const slots = [16, 17, 18, 19, 0, 1, 2, 3].map((x) => regionalSlot(window, x, 2, 8).sx);
    expect(new Set(slots).size).toBe(8);
    const s = view({ lat: 10, lon: 179, dist: 3.1 });
    const used = s.tiles.map((t) => { const { sx, sy } = regionalSlot(s.window, t.x, t.y, 8); return `${sx},${sy}`; });
    expect(new Set(used).size).toBe(s.tiles.length);
    expect(s.tiles.some((t) => t.x === 0) && s.tiles.some((t) => t.x === s.window.columns - 1)).toBe(true);
  });
});

// --- runtime with a fake clock, a fake loader and a renderer stub -----------------------------------------
function harness({ touch = false, pixelRatio = 1, policy = REGIONAL_POLICY } = {}) {
  let t = 0;
  const requests = [];
  const loadImage = (url, { signal }) => new Promise((resolve, reject) => {
    const r = { url, signal, resolve: () => resolve({ width: 512, height: 512, close: vi.fn() }), reject };
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    requests.push(r);
  });
  const renderer = { getPixelRatio: () => pixelRatio, domElement: { clientHeight: 900 }, copyTextureToTexture: vi.fn(), initTexture: vi.fn() };
  const outer = new AbortController();
  const statuses = [];
  const regional = createRegionalSurface({ THREE, renderer, touch, loadImage, signal: outer.signal, now: () => t, policy, onStatus: (s) => statuses.push(s) });
  const earth = new THREE.Object3D();
  const cam = new THREE.PerspectiveCamera(45, 1600 / 900, 0.1, 100);
  const look = (dist, lat = ALPS.lat, lon = ALPS.lon) => { cam.position.copy(unit(lat, lon).multiplyScalar(dist)); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true); };
  const frame = (ms = 16) => { t += ms; regional.update(cam, earth); };
  // setImmediate, not setTimeout(0): on Windows a 0 ms timer waits up to ~15 ms, and these tests flush hundreds of times.
  const flush = () => new Promise((r) => setImmediate(r));
  const settle = async () => { for (let i = 0; i < 10; i++) await flush(); };
  return { regional, renderer, requests, outer, statuses, look, frame, settle, advance: (ms) => { t += ms; } };
}

describe('LOT 41: regional runtime (debounce, budget, LRU, cancellation)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('far from the globe: no request, no atlas, the shader branch off', () => {
    const h = harness();
    h.look(6.4); for (let i = 0; i < 100; i++) h.frame();
    h.regional.bindRenderer(h.renderer);
    expect(h.requests).toHaveLength(0);
    expect(h.renderer.initTexture).not.toHaveBeenCalled();
    expect(h.regional.uniforms.uRegionalOnTw.value).toBe(0);
    expect(h.regional.getStatus().state).toBe('off');
  });

  it('debounce: nothing is requested until the window is the same for 300 ms; a moving view requests nothing', async () => {
    const h = harness();
    // a fast pan: the window key changes every frame
    for (let i = 0; i < 40; i++) { h.look(3.1, ALPS.lat, ALPS.lon + i * 3); h.frame(16); }
    await h.settle();
    expect(h.requests).toHaveLength(0);
    h.look(3.1); h.frame(16);
    for (let i = 0; i < 17; i++) h.frame(16); // 272 ms stable
    await h.settle();
    expect(h.requests).toHaveLength(0);
    expect(h.regional.getDebugState().pending).toBe('5:17,3,8x4');
    h.frame(40); // > 300 ms
    await h.settle();
    expect(h.requests.length).toBeGreaterThan(0);
  });

  it('at most 6 requests on the network (desktop), 4 on touch; the closest tile first', async () => {
    const h = harness();
    h.look(3.1); h.frame(); h.frame(400);
    await h.settle();
    expect(h.requests).toHaveLength(6);
    expect(h.requests[0].url).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/default/500m/5/4/20.jpeg');
    expect(h.requests.slice(0, 4).map((r) => r.url.split('/500m/')[1]).sort()).toEqual(['5/4/20.jpeg', '5/4/21.jpeg', '5/5/20.jpeg', '5/5/21.jpeg']);
    expect(h.regional.getDebugState()).toMatchObject({ inflight: 31, activeRequests: 6 });
    const touch = harness({ touch: true, pixelRatio: 2 });
    touch.look(3.1); touch.frame(); touch.frame(400);
    await touch.settle();
    expect(touch.requests).toHaveLength(4);
    expect(touch.regional.getDebugState()).toMatchObject({ slots: 4, atlasSize: 2048, profile: { maxLevel: 5 } });
  });

  it('arrivals are uploaded at most 2 per frame into fixed slots, the table says which tile each slot holds', async () => {
    const h = harness();
    h.look(3.1); h.frame(); h.frame(400);
    await h.settle();
    h.requests.slice(0, 3).forEach((r) => r.resolve());
    await h.settle();
    h.frame();
    expect(h.renderer.copyTextureToTexture).toHaveBeenCalledTimes(2);
    h.frame();
    expect(h.renderer.copyTextureToTexture).toHaveBeenCalledTimes(3);
    const [, atlas, , pos] = h.renderer.copyTextureToTexture.mock.calls[0];
    expect(atlas.image.width).toBe(4096);
    expect(pos).toEqual({ x: (20 % 8) * 512, y: (4 % 8) * 512, z: 0 }); // tile 5/20/4 -> slot (4, 4)
    const table = h.regional.uniforms.uRegionalTableTw.value.image.data;
    expect([...table.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 3)]).toEqual([20, 4, 5]);
    h.regional.bindRenderer(h.renderer);
    expect(h.regional.uniforms.uRegionalOnTw.value).toBe(1);
    h.regional.bindRenderer({}); // an export renderer: z3 only
    expect(h.regional.uniforms.uRegionalOnTw.value).toBe(0);
  });

  it('cancellation: tiles that leave the window are aborted; going beyond 4.6 aborts everything; no orphan', async () => {
    const h = harness();
    h.look(3.1); h.frame(); h.frame(400);
    await h.settle();
    const first = h.requests.slice();
    h.look(3.1, -30, -60); h.frame(); h.frame(400); // another region
    await h.settle();
    expect(first.every((r) => r.signal.aborted)).toBe(true);
    const second = h.requests.filter((r) => !first.includes(r));
    expect(second.length).toBeGreaterThan(0);
    h.look(6.4); h.frame();
    await h.settle();
    expect(second.every((r) => r.signal.aborted)).toBe(true);
    expect(h.regional.getDebugState()).toMatchObject({ inflight: 0, activeRequests: 0, queuedUploads: 0, enabled: false });
    const before = h.requests.length;
    for (let i = 0; i < 50; i++) h.frame();
    await h.settle();
    expect(h.requests.length).toBe(before);
  });

  it('LRU and slots: going back to a region requests nothing again (tiles still in their slots, or re-uploaded from the LRU)', async () => {
    const policy = { ...REGIONAL_POLICY, desktop: { ...REGIONAL_POLICY.desktop, lruTiles: 128 } }; // room for both regions
    const h = harness({ policy });
    const loadAll = async () => {
      for (let round = 0; round < 12; round++) { await h.settle(); h.requests.filter((r) => !r.done && !r.signal.aborted).forEach((r) => { r.done = true; r.resolve(); }); }
      await h.settle();
      for (let i = 0; i < 40; i++) h.frame(); // uploads, 2 per frame
    };
    h.look(3.1); h.frame(); h.frame(400); await loadAll();
    expect(h.regional.getStatus()).toMatchObject({ state: 'active', wanted: 31, resident: 31 });
    h.look(3.1, -30, -60); h.frame(); h.frame(400); await loadAll(); // away: its tiles overwrite part of the slots
    const requestedAway = h.regional.getDebugState().stats.requested;
    h.look(3.1); h.frame(); h.frame(400); await loadAll(); // back
    const st = h.regional.getDebugState().stats;
    expect(st.requested).toBe(requestedAway); // no new request
    expect(st.cacheHits).toBeGreaterThan(0); // the overwritten slots came back from the LRU
    expect(h.regional.getStatus()).toMatchObject({ state: 'active', wanted: 31, resident: 31 });
  });

  it('a failed tile: status partial, z3 shown there, said in the surface line and as a secondary runtime reason', async () => {
    const h = harness({ policy: { ...REGIONAL_POLICY, backoffMs: [] } }); // the retry comes at once (no real 1 s wait)
    h.look(3.1); h.frame(); h.frame(400);
    // every attempt for tile 5/21/4 fails (the first one and its retry); the others arrive
    const answer = () => h.requests.filter((r) => !r.done && !r.signal.aborted).forEach((r) => { r.done = true; if (r.url.includes('/5/4/21.')) r.reject(Object.assign(new Error('HTTP 500'), { status: 500 })); else r.resolve(); });
    await vi.waitFor(async () => { await h.settle(); answer(); await h.settle(); for (let i = 0; i < 20; i++) h.frame(); expect(h.regional.getStatus()).toMatchObject({ state: 'partial', resident: 30, failed: 1 }); }, { timeout: 8000, interval: 100 });
    const status = h.regional.getStatus();
    expect(status).toMatchObject({ state: 'partial', level: 5, wanted: 31, resident: 30, failed: 1 });
    expect(describeRegionalStatus(status)).toBe(` · regional detail z5: 1 of 31 tiles unavailable — z3 shown there; ${REGIONAL_LABEL}`);
    const base = { relief: 'ktx2', surface: { kind: 'settled' }, sun: 'astronomy-engine', eonet: { state: 'live' }, sky: 'MAP + STARS' };
    expect(earthRuntimeState({ ...base, regional: status })).toMatchObject({ state: 'live', secondary: [EARTH_RUNTIME_REASONS.surfaceDetail] });
    expect(earthRuntimeState({ ...base, regional: { state: 'active' } })).toMatchObject({ state: 'live', secondary: [] });
  });

  it('dispose aborts the requests and closes the cached bitmaps', async () => {
    const h = harness();
    h.look(3.1); h.frame(); h.frame(400);
    await h.settle();
    h.requests[0].resolve();
    await h.settle();
    h.regional.dispose();
    await h.settle();
    expect(h.requests.slice(1).every((r) => r.signal.aborted)).toBe(true);
    expect(h.regional.getDebugState()).toMatchObject({ inflight: 0 });
  });
});

describe('LOT 41: provenance text, shader and wiring', () => {
  it('status texts: off adds nothing; active names the level and the observed composite label (no "interpretive")', () => {
    expect(describeRegionalStatus({ state: 'off' })).toBe('');
    expect(describeRegionalStatus({ state: 'active', level: 5, wanted: 31, resident: 31, failed: 0 })).toBe(' · regional detail z5 (31/31 tiles); observed composite (NASA Blue Marble NG, 500 m)');
    expect(describeRegionalStatus({ state: 'unavailable', level: 5, wanted: 31, resident: 0, failed: 31 })).toBe(' · regional detail z5 unavailable (31 tiles failed) — z3 shown');
    expect(text('src/earth/gibs-regional-surface.js')).not.toMatch(/interpretive/i);
  });

  it('the blend sits right after <map_fragment> (before the day/night tint) and is skipped when off', () => {
    const shader = { uniforms: {}, fragmentShader: '#include <common>\nvoid main(){\n#include <map_fragment>\n// tint\n}' };
    injectRegionalSurface(shader, { uniforms: { uRegionalOnTw: { value: 0 } } });
    expect(shader.fragmentShader.indexOf('uniform float uRegionalOnTw;')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <common>'));
    const body = shader.fragmentShader.indexOf('if (uRegionalOnTw > 0.5) {');
    expect(body).toBeGreaterThan(shader.fragmentShader.indexOf('#include <map_fragment>'));
    expect(body).toBeLessThan(shader.fragmentShader.indexOf('// tint'));
    expect(shader.uniforms.uRegionalOnTw.value).toBe(0);
    const material = text('src/earth/earth-material.js');
    expect(material.match(/injectRegionalSurface\(shader, regionalSurface\); \/\/ LOT 41/g)).toHaveLength(2);
  });

  it('earth-layers: none in a visual lock, owned by the layers signal, disposed; frame loop drives it', () => {
    const layers = text('src/earth/earth-layers.js');
    expect(layers).toContain('const regionalSurface = surfaceVisualCase ? null : createRegionalSurface({');
    expect(layers).toContain('signal: gibsController.signal,');
    expect(layers).toContain('regionalSurface?.dispose(); // LOT 41: requests, LRU bitmaps, atlas');
    expect(layers).toContain('regionalSurface?.bindRenderer(_renderer); // LOT 41: the atlas lives in the page renderer only');
    expect(text('src/earth/frame-runtime.js')).toContain('updateRegionalSurface?.(camera); // LOT 41');
    expect(REGIONAL_POLICY).toMatchObject({ activationDistance: 4.6, debounceMs: 300, uploadsPerFrame: 2 });
  });
});
