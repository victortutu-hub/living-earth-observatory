// LOT 42: Terrarium relief slopes near the globe (src/earth/terrarium-relief.js, terrarium-prep.js).
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from '../lib/three@0.185.1/build/three.module.js';
import {
  ETOPO_TEXEL_KM, MERCATOR_MAX_LAT, TERRAIN_LABEL, TERRAIN_POLICY, TERRAIN_SLOPE_MARKER, cleanTerrariumHeights, createTerrainPreparer,
  createTerrainRelief, describeTerrainStatus, injectTerrainRelief, mercatorPixelKm, mercatorTileCoords, parseTerrariumUrl,
  prepareTerrainHeights, rowPixelMetres, slopeMipChain, terrainBaseLod, terrainLevelFor, terrainProfile, terrainShadingGain,
  terrariumSlopes, toHalfBits, TERRARIUM_WINDOW_SOURCE,
} from '../src/earth/terrarium-relief.js';
import { selectTileWindow } from '../src/earth/gibs-regional-surface.js';
import { EARTH_RUNTIME_REASONS, earthRuntimeState } from '../src/earth/earth-runtime-state.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import { EXTERNAL_ORIGINS } from '../tools/external-origins.mjs';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const unit = (lat, lon) => { const phi = (lon + 180) / 360 * 2 * Math.PI; const theta = (90 - lat) / 180 * Math.PI; return new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)); };
function view({ lat = 46.5, lon = 10, dist, pixelRatio = 1, touch = false }) {
  const cam = new THREE.PerspectiveCamera(45, 1600 / 900, 0.1, 100);
  cam.position.copy(unit(lat, lon).multiplyScalar(dist)); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
  const col = (i) => new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, i).toArray();
  const profile = terrainProfile({ touch, pixelRatio });
  return selectTileWindow({ camera: cam.position.toArray(), forward: col(2).map((c) => -c), right: col(0), up: col(1), fovDeg: 45, aspect: 16 / 9, heightPx: 900, pixelRatio, maxLevel: profile.maxLevel, slots: profile.slots, policy: TERRAIN_POLICY, source: TERRARIUM_WINDOW_SOURCE });
}
// The shader's Web Mercator row, in JS (same expression as TERRAIN_FRAGMENT_BODY).
const shaderTileY = (level, lat) => (1 - Math.log(Math.tan(0.25 * Math.PI + 0.5 * lat * Math.PI / 180)) / Math.PI) * 0.5 * 2 ** level;

describe('LOT 42: Web Mercator sampling on the globe', () => {
  it('known tiles: (0, 0) at z1 is the corner of tile (1, 1); the LOT 40 probe tiles of the Alps (z7, z9, z15)', () => {
    expect(mercatorTileCoords(1, 0, 0)).toEqual({ x: 1, y: 1 });
    for (const [z, x, y] of [[7, 67, 45], [9, 270, 181], [15, 17294, 11591]]) {
      const t = mercatorTileCoords(z, 46.5, 10);
      expect([Math.floor(t.x), Math.floor(t.y)]).toEqual([x, y]);
    }
    expect(mercatorTileCoords(3, MERCATOR_MAX_LAT, -180).y).toBeCloseTo(0, 9);
    expect(mercatorTileCoords(3, -MERCATOR_MAX_LAT, 180)).toMatchObject({ x: 8 });
  });

  it('the shader row formula is the tile maths of src/himalaya/terrarium.js (no stretching: exact per latitude)', () => {
    for (const lat of [-85, -60, -28.5, 0, 27.99, 46.5, 60, 80, 85]) for (const z of [5, 6, 7]) {
      expect(shaderTileY(z, lat)).toBeCloseTo(mercatorTileCoords(z, lat, 0).y, 6);
    }
  });

  it('a pixel is square on the ground: R cos(lat) x 360 / (256 x 2^z) deg; rows give their own latitude', () => {
    expect(mercatorPixelKm(0, 0)).toBeCloseTo(2 * Math.PI * 6371 / 256, 9);
    expect(mercatorPixelKm(6, 46.5)).toBeCloseTo(2 * Math.PI * 6371 * Math.cos(46.5 * Math.PI / 180) / (256 * 64), 9);
    // z1 tile (0, 0): the first row is near 85 N, the last near the equator
    expect(rowPixelMetres(1, 0, 0) / 1000).toBeCloseTo(mercatorPixelKm(1, Math.atan(Math.sinh(Math.PI * (1 - 2 * (0.5 / 256) / 2))) * 180 / Math.PI), 9);
    expect(rowPixelMetres(1, 0, 255) / 1000).toBeCloseTo(mercatorPixelKm(1, 0), 1);
  });

  it('beyond |lat| 85.0511 there are no tiles (ETOPO only)', () => {
    expect(TERRARIUM_WINDOW_SOURCE.covers({ lat: 85.05 })).toBe(true);
    expect(TERRARIUM_WINDOW_SOURCE.covers({ lat: -85.06 })).toBe(false);
    const polar = view({ lat: 89, lon: 0, dist: 3.1 });
    expect(polar.active).toBe(true);
    for (const t of polar.tiles) expect(t.y).toBeGreaterThanOrEqual(0);
    expect(text('src/earth/terrarium-relief.js')).toContain('* step(abs(terLatTw), 85.0511);');
  });
});

describe('LOT 42: level and tile selection (1600 x 900)', () => {
  it('levels from the screen pixel: coarsest Mercator pixel <= footprint; none when ETOPO is enough', () => {
    expect(ETOPO_TEXEL_KM).toBeCloseTo(18.53, 2);
    expect(terrainLevelFor(20, 46.5, 7)).toBe(null);
    expect(terrainLevelFor(7.3, 46.5, 7)).toBe(5); // z5 3.4 km at 46.5 N
    expect(terrainLevelFor(3.2, 46.5, 7)).toBe(6);
    expect(terrainLevelFor(1.6, 46.5, 7)).toBe(7);
    expect(terrainLevelFor(1.6, 46.5, 6)).toBe(6); // touch cap
  });

  it('Alps: 3.1 -> z6, a 10 x 10 window of 84 tiles (as in the page); pixel ratio 2 -> z7; 4.5 -> z5', () => {
    expect(view({ dist: 3.1 })).toMatchObject({ active: true, level: 6, window: { x0: 29, y0: 18, w: 10, h: 10, columns: 64 } });
    expect(view({ dist: 3.1 }).tiles).toHaveLength(84);
    expect(view({ dist: 3.1, pixelRatio: 2 })).toMatchObject({ level: 7 });
    expect(view({ dist: 4.5 })).toMatchObject({ active: true, level: 5 });
  });

  it('touch: z6 at most, 6 x 6 slots, 4 requests; desktop 10 x 10, 6 requests; fixed GPU memory', () => {
    expect(view({ dist: 3.1, pixelRatio: 3, touch: true })).toMatchObject({ level: 6, window: { w: 6, h: 6 } });
    expect(terrainProfile({ touch: true })).toMatchObject({ maxLevel: 6, slots: 6, concurrency: 4, lruTiles: 8 });
    expect(terrainProfile()).toMatchObject({ maxLevel: 7, slots: 10, concurrency: 6, lruTiles: 32 });
    expect(Math.round(2560 * 2560 * 4 * 4 / 3 / 2 ** 20)).toBe(33); // RG16F + mips
    expect(Math.round(1536 * 1536 * 4 * 4 / 3 / 2 ** 20)).toBe(12);
  });

  it('nothing at distance >= 4.6 (6.4, 12)', () => {
    for (const dist of [4.6, 6.4, 12]) expect(view({ dist })).toMatchObject({ active: false, reason: 'distance' });
  });
});

describe('LOT 42: anomalies (voids and spikes) are replaced', () => {
  const flat = (size, v) => new Float32Array(size * size).fill(v);
  it('Lake Garda at z7: -810 m among 39-428 m neighbours (pixel ~ 850 m) -> the neighbour median', () => {
    const h = flat(5, 65); h.set([39, 70, 428], 6); h[12] = -810; // centre (2, 2)
    const { heights, replaced } = cleanTerrariumHeights(h, 5, () => 850);
    expect(replaced).toBe(1);
    expect(heights[12]).toBe(65);
  });

  it('a void column at z15: -489 m in 2368 m terrain (pixel ~ 3 m) -> the whole column replaced', () => {
    const size = 8; const h = flat(size, 2368);
    for (let y = 0; y < size; y++) h[y * size + 3] = -489 + y * 0.1;
    const { heights, replaced } = cleanTerrariumHeights(h, size, () => 3.3);
    expect(replaced).toBe(size);
    for (let y = 0; y < size; y++) expect(heights[y * size + 3]).toBe(2368);
  });

  it('the median rule alone (heights within the physical bounds): a 300 m hole in 2368 m terrain, a +1500 m spike in 3000 m terrain', () => {
    const size = 8; const hole = flat(size, 2368); hole[3 * size + 3] = 300;
    expect(cleanTerrariumHeights(hole, size, () => 850)).toMatchObject({ replaced: 1 });
    const spike = flat(5, 3000); spike[12] = 4500;
    const out = cleanTerrariumHeights(spike, 5, () => 850);
    expect([out.replaced, out.heights[12]]).toEqual([1, 3000]);
  });

  it('real relief is kept: a 35 deg slope (600 m per 850 m pixel), a 1 km peak over 2 km-pixels, Everest; out of bounds replaced', () => {
    const size = 6; const ramp = new Float32Array(size * size).map((_, i) => (i % size) * 600);
    expect(cleanTerrariumHeights(ramp, size, () => 850).replaced).toBe(0);
    const peak = flat(5, 3000); peak[12] = 4000;
    expect(cleanTerrariumHeights(peak, 5, () => 2000).replaced).toBe(0);
    const everest = flat(5, 8000); everest[12] = 8849;
    expect(cleanTerrariumHeights(everest, 5, () => 1000).replaced).toBe(0);
    const low = flat(5, -400); low[12] = -460; // below the lowest dry land
    expect(cleanTerrariumHeights(low, 5, () => 850)).toMatchObject({ replaced: 1 });
    const high = flat(5, 8500); high[12] = 9500;
    expect(cleanTerrariumHeights(high, 5, () => 850).heights[12]).toBe(8500);
  });
});

describe('LOT 42: slopes, mips, half floats', () => {
  it('slopes over the real distance: a 0.25 east plane and a 0.1 north plane; the sea (h < 0) counts as 0 m', () => {
    const size = 8; const d = 1000;
    const east = new Float32Array(size * size).map((_, i) => (i % size) * 0.25 * d);
    const s = terrariumSlopes(east, size, () => d);
    expect([s[(3 * size + 4) * 2], s[(3 * size + 4) * 2 + 1]]).toEqual([0.25, 0]);
    expect(s[(3 * size + 0) * 2]).toBe(0.25); // one-sided at the edge
    const north = new Float32Array(size * size).map((_, i) => (size - 1 - Math.floor(i / size)) * 0.1 * d); // row 0 = north = highest
    expect(terrariumSlopes(north, size, () => d)[(4 * size + 4) * 2 + 1]).toBeCloseTo(0.1, 6); // float32
    const coast = new Float32Array(size * size).map((_, i) => ((i % size) < 4 ? -50 : 0));
    expect(Math.max(...terrariumSlopes(coast, size, () => d))).toBe(0);
  });

  it('mip chain: box average of the slopes, 256 -> 1 (9 levels)', () => {
    const rg = new Float32Array(256 * 256 * 2).map((_, i) => (i % 2 ? 1 : (Math.floor(i / 2) % 2)));
    const levels = slopeMipChain(rg, 256);
    expect(levels.map((l) => l.size)).toEqual([256, 128, 64, 32, 16, 8, 4, 2, 1]);
    expect([...levels[8].data]).toEqual([0.5, 1]);
  });

  it('toHalfBits rounds to the nearest half float (three.js DataUtils.toHalfFloat truncates: at most 1 unit apart)', () => {
    const values = [0, -0, 1, -1, 0.5, 0.1, 0.333, 2.75, 1e-5, -1e-7, 65504, -3.5, 1 / 3, 6.1e-5];
    for (let i = 0; i < 500; i++) values.push((Math.sin(i * 12.9898) * 43758.5453 % 1) * 4);
    const back = (bits) => THREE.DataUtils.fromHalfFloat(bits);
    for (const v of values) {
      const mine = toHalfBits(v); const three = THREE.DataUtils.toHalfFloat(v);
      expect(Math.abs(mine - three), String(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(back(mine) - v), String(v)).toBeLessThanOrEqual(Math.abs(back(three) - v) + 1e-12); // never worse
    }
    expect([toHalfBits(0.333), THREE.DataUtils.toHalfFloat(0.333)]).toEqual([13652, 13651]); // 0.33301 vs 0.33276
    expect(toHalfBits(70000)).toBe(0x7c00); // overflow -> infinity
  });

  it('prepareTerrainHeights: cleaned heights -> RG16F mip chain (Uint16Array), with the replaced count', () => {
    const size = 256; const h = new Float32Array(size * size).map((_, i) => (i % size) * 10);
    h[1000] = -9999;
    const out = prepareTerrainHeights(h, size, 6, 22);
    expect(out.replaced).toBe(1);
    expect(out.levels.map((l) => [l.size, l.data.length, l.data.constructor.name])[0]).toEqual([256, 256 * 256 * 2, 'Uint16Array']);
    expect(out.levels).toHaveLength(9);
  });
});

describe('LOT 42: shading gain (ETOPO unchanged)', () => {
  it('G = 30 at the ETOPO texel (base lod), z5 7.9 / z6 4.0 / z7 2.0 at full resolution, never below 1', () => {
    for (const z of [5, 6, 7]) expect(terrainShadingGain(z, terrainBaseLod(z))).toBeCloseTo(30, 9);
    expect([5, 6, 7].map((z) => +terrainShadingGain(z, 0).toFixed(2))).toEqual([7.91, 3.96, 1.98]);
    expect(terrainShadingGain(9, 0)).toBe(1);
    expect([5, 6, 7].map((z) => +terrainBaseLod(z).toFixed(3))).toEqual([1.923, 2.923, 3.923]);
  });

  it('the ETOPO slope code is unchanged; the marker is a GLSL comment until the terrain layer replaces it', () => {
    const material = text('src/earth/earth-material.js');
    expect(material).toContain('vec2 reliefSlopeTw = uShadingGainTw * vec2(');
    expect(material).toContain('(hETw - hWTw) / (4.0 * PI * R_E * reliefCosLatTw * reliefTexelTw.x),');
    expect(material).toContain('${TERRAIN_SLOPE_MARKER}');
    expect(TERRAIN_SLOPE_MARKER.startsWith('//')).toBe(true);
    expect(material.match(/injectTerrainRelief\(shader, terrainRelief\); \/\/ LOT 42/g)).toHaveLength(2);
    const shader = { uniforms: {}, fragmentShader: `#include <common>\nvoid main(){ vec2 reliefSlopeTw = vec2(0.0);\n${TERRAIN_SLOPE_MARKER}\n}` };
    injectTerrainRelief(shader, { uniforms: { uTerrainOnTw: { value: 0 } } });
    expect(shader.fragmentShader).toContain('if (uTerrainOnTw > 0.5) {');
    expect(shader.fragmentShader).toContain('reliefSlopeTw = mix(reliefSlopeTw, terGainTw * terSlopeTw, terWeightTw);');
    expect(shader.fragmentShader).not.toContain(TERRAIN_SLOPE_MARKER);
  });
});

describe('LOT 42: runtime (worker ownership, no request far away), provenance, state', () => {
  it('far from the globe: no request; close: requests through the loader, 6 at most', async () => {
    let t = 0; const urls = [];
    const renderer = { getPixelRatio: () => 1, domElement: { clientHeight: 900 }, copyTextureToTexture: vi.fn(), initTexture: vi.fn() };
    const layer = createTerrainRelief({ THREE, renderer, now: () => t, loadImage: (url) => { urls.push(url); return new Promise(() => {}); } });
    const cam = new THREE.PerspectiveCamera(45, 1600 / 900, 0.1, 100); const earth = new THREE.Object3D();
    const look = (d) => { cam.position.copy(unit(46.5, 10).multiplyScalar(d)); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true); };
    look(6.4); for (let i = 0; i < 50; i++) { t += 16; layer.update(cam, earth); }
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    expect(urls).toHaveLength(0);
    expect(renderer.initTexture).not.toHaveBeenCalled();
    look(3.1); t += 16; layer.update(cam, earth); t += 400; layer.update(cam, earth);
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    expect(urls).toHaveLength(6);
    expect(urls[0]).toMatch(/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/6\/\d+\/\d+\.png$/);
    layer.dispose();
  });

  it('the worker is owned: messages resolve, dispose terminates and rejects what is pending; a worker error falls back inline', async () => {
    const posted = [];
    const worker = { postMessage: (m, transfer) => posted.push([m, transfer]), terminate: vi.fn(), onmessage: null, onerror: null };
    const preparer = createTerrainPreparer({ createWorker: () => worker, prepareInline: () => ({ levels: [], replaced: 0, inline: true }) });
    expect(preparer.usesWorker).toBe(true);
    const bitmap = { width: 256, height: 256, close: vi.fn() };
    const first = preparer.prepare(bitmap, 6, 22);
    expect(posted[0][0]).toMatchObject({ id: 1, level: 6, tileY: 22 });
    expect(posted[0][1]).toEqual([bitmap]); // transferred
    worker.onmessage({ data: { id: 1, levels: [{ size: 1, data: new Uint16Array(2) }], replaced: 3 } });
    await expect(first).resolves.toMatchObject({ replaced: 3 });
    const second = preparer.prepare(bitmap, 6, 22);
    worker.onerror({ message: 'boom', preventDefault: () => {} });
    await expect(second).rejects.toThrow('Terrarium worker error: boom');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(preparer.usesWorker).toBe(false);
    await expect(preparer.prepare(bitmap, 6, 22)).resolves.toMatchObject({ inline: true });
    const other = { postMessage: () => {}, terminate: vi.fn() };
    const p2 = createTerrainPreparer({ createWorker: () => other });
    const pending = p2.prepare(bitmap, 5, 1);
    p2.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(other.terminate).toHaveBeenCalled();
    expect(parseTerrariumUrl('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/6/33/22.png')).toEqual({ level: 6, x: 33, y: 22 });
  });

  it('provenance: the registry calls Terrarium reconstructed (merged DEMs); the label says so, with the source per level', () => {
    const def = SOURCE_DEFINITIONS.terrariumTiles;
    expect(def.provenance).toBe('reconstructed');
    expect(def.observatories).toEqual(['living-himalaya', 'living-earth']);
    expect(def.license).toContain('Mapzen');
    expect(TERRAIN_LABEL).toBe('reconstructed DEM (Terrarium, Mapzen / Tilezen joerd: GMTED2010 at z5-z6, SRTM at z7, GMTED2010 above 60°)');
    expect(describeTerrainStatus({ state: 'active', level: 6, wanted: 84, resident: 84, failed: 0 })).toBe(` · relief detail z6 (84/84 tiles); ${TERRAIN_LABEL}`);
    expect(describeTerrainStatus({ state: 'off' })).toBe('');
    expect(describeTerrainStatus({ state: 'unavailable', level: 6, wanted: 84, resident: 0, failed: 84 })).toBe(' · relief detail z6 unavailable (84 tiles failed) — ETOPO shown');
    expect(EXTERNAL_ORIGINS.find((o) => o.origin === 'https://s3.amazonaws.com').pages).toEqual(['himalaya', 'earth']);
  });

  it('missing tiles -> secondary relief-detail-fallback, the state stays LIVE (ETOPO shown)', () => {
    const base = { relief: 'ktx2', surface: { kind: 'settled' }, sun: 'astronomy-engine', eonet: { state: 'live' }, sky: 'MAP + STARS' };
    expect(earthRuntimeState({ ...base, terrain: { state: 'partial' } })).toMatchObject({ state: 'live', secondary: [EARTH_RUNTIME_REASONS.reliefDetail] });
    expect(earthRuntimeState({ ...base, terrain: { state: 'unavailable' }, regional: { state: 'partial' } }).secondary).toEqual(['surface-detail-fallback', 'relief-detail-fallback']);
    expect(earthRuntimeState({ ...base, terrain: { state: 'active' } }).secondary).toEqual([]);
  });
});
