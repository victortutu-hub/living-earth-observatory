// LOT 43: the land / water weight near the coast (src/earth/coast-mask.js, earth-material.js, earth-layers.js).
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from '../lib/three@0.185.1/build/three.module.js';
import {
  COAST_FALLBACK_LABEL, COAST_LABEL, COAST_MASK, coastDistanceFromSample, coastFieldWidth, coastMaskGlsl, coastWaterFraction, loadCoastMask, rgbaToR8SouthFirst,
} from '../src/earth/coast-mask.js';
import { createEarthMaterial, createEarthMaterialPBR } from '../src/earth/earth-material.js';
import { linearReliefLabel } from '../src/earth/relief-linear.js';
import { EARTH_RUNTIME_REASONS, earthRuntimeState } from '../src/earth/earth-runtime-state.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('LOT 43: land / water weight (coast-mask.js, the same rule as the shader)', () => {
  const w = (o) => coastWaterFraction({ maxKm: 32, ...o });
  it('the coast edge is one screen pixel wide at any zoom', () => {
    expect(w({ distanceKm: 0, footprintKm: 3, mod44wWater: 0.5 })).toBeCloseTo(0.5, 12);
    expect(w({ distanceKm: 1, footprintKm: 4, mod44wWater: 0.6 })).toBeCloseTo(0.25, 12);
    expect(w({ distanceKm: -1.5, footprintKm: 3, mod44wWater: 0 })).toBe(1);
    expect(w({ distanceKm: 1.5, footprintKm: 1.5, mod44wWater: 0.3 })).toBe(0);
  });
  it('lakes: MOD44W water from 12-20 km inland; closer, the coarse MOD44W coastal sea is dropped', () => {
    expect(w({ distanceKm: 32, footprintKm: 3, mod44wWater: 1 })).toBe(1); // Lake Superior
    expect(w({ distanceKm: 25, footprintKm: 3, mod44wWater: 0.4 })).toBeCloseTo(0.4, 12);
    expect(w({ distanceKm: 16, footprintKm: 3, mod44wWater: 1 })).toBeCloseTo(0.5, 12);
    expect(w({ distanceKm: 6, footprintKm: 3, mod44wWater: 0.8 })).toBe(0);
    expect(COAST_MASK.inlandKm).toEqual([12, 20]);
  });
  it('sea: Natural Earth only (MOD44W land in the sea near the coast is its coarse coastal texel)', () => {
    expect(w({ distanceKm: -8, footprintKm: 3, mod44wWater: 0.2 })).toBe(1);
  });
  it('a pixel wider than the encoded range: MOD44W alone (32 -> 48 km); before loading: MOD44W', () => {
    expect(w({ distanceKm: 32, footprintKm: 48, mod44wWater: 0.3 })).toBeCloseTo(0.3, 12);
    expect(w({ distanceKm: 32, footprintKm: 40, mod44wWater: 0 })).toBeCloseTo(0, 12);
    expect(w({ distanceKm: -32, footprintKm: 40, mod44wWater: 0 })).toBeCloseTo(0.5, 12);
    expect(w({ distanceKm: -32, footprintKm: 3, mod44wWater: 0, ready: false })).toBe(0);
  });
  it('the shader carries the same constants; a texture sample decodes to km', () => {
    const glsl = coastMaskGlsl(32);
    for (const s of ['uniform sampler2D uCoastDistTw;', 'uniform float uCoastReadyTw;', 'float coastWaterTw(vec2 uv, float mod44wWater)', 'smoothstep(12.0, 20.0, coastDTw)', 'smoothstep(32.0, 48.0, coastFootTw)', '/ 127.5 * 32.0', 'max(coastFootTw, 0.05)', 'mix(mod44wWater, coastWaterOutTw, uCoastReadyTw)']) expect(glsl).toContain(s);
    expect(coastDistanceFromSample(127.5 / 255, 32)).toBeCloseTo(0, 12);
    expect(coastDistanceFromSample(1, 32)).toBeCloseTo(32, 12);
  });
  it('field size: 8192 wide on desktop, 4096 on touch or when the GPU limit is below 8192', () => {
    expect(coastFieldWidth({})).toBe(8192);
    expect(coastFieldWidth({ touch: true })).toBe(4096);
    expect(coastFieldWidth({ maxTextureSize: 4096 })).toBe(4096);
    expect(rgbaToR8SouthFirst(Uint8Array.from([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0]), 2, 2)).toEqual(Uint8Array.from([3, 4, 1, 2]));
  });
});

describe('LOT 43: materials use one mask for relief, specular and roughness', () => {
  const fakeShader = () => ({
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>\n#include <displacementmap_vertex>\n#include <worldpos_vertex>\n',
    fragmentShader: '#include <common>\n#include <map_fragment>\n#include <specularmap_fragment>\n#include <normal_fragment_maps>\n#include <opaque_fragment>\n',
  });
  const tex = new THREE.Texture();
  const coastMask = { uniform: { value: tex }, ready: { value: 1 } };
  it.each([
    ['Phong', () => createEarthMaterial({ THREE, earthMap: tex, earthSpecular: tex, earthRelief: tex, coastMask })],
    ['PBR', () => createEarthMaterialPBR({ THREE, earthMap: tex, earthRoughnessMap: tex, earthRelief: tex, coastMask })],
  ])('%s', (name, build) => {
    const material = build(); const shader = fakeShader();
    material.onBeforeCompile(shader);
    expect(shader.uniforms.uCoastDistTw).toBe(coastMask.uniform); // shared with every material
    expect(shader.uniforms.uCoastReadyTw).toBe(coastMask.ready);
    expect(shader.fragmentShader).toContain('return coastWaterTw(uv, mix(step(h, 0.0), texture2D(uWaterMaskTw, uv).r, uWaterMaskReadyTw));');
    expect(shader.fragmentShader).toContain('float surfaceLandWeightTw = 1.0 - reliefWaterTw(vMapUv, surfaceReliefTw);');
    expect(shader.fragmentShader.indexOf('float coastWaterTw(')).toBeLessThan(shader.fragmentShader.indexOf('float reliefWaterTw('));
    expect(shader.vertexShader).not.toContain('uCoastDistTw'); // the vertex displacement keeps MOD44W
    if (name === 'Phong') expect(shader.fragmentShader).toContain('specularStrength = mix(specularStrength, 1.0 - surfaceLandWeightTw, uCoastReadyTw);');
    else expect(shader.fragmentShader).toContain('mix(roughnessFactor < 0.3 ? 0.68 : roughnessFactor, 0.22, 1.0 - surfaceLandWeightTw), uCoastReadyTw);');
  });
  it('without a coast mask the uniforms are inert (ready 0)', () => {
    const shader = fakeShader();
    createEarthMaterial({ THREE, earthMap: tex, earthSpecular: tex, earthRelief: tex }).onBeforeCompile(shader);
    expect(shader.uniforms.uCoastReadyTw.value).toBe(0);
  });
});

describe('LOT 43: loader lifecycle, status and provenance', () => {
  const ok = () => ({ ok: true, blob: async () => new Blob([new Uint8Array(4)]) });
  const decoder = () => ({ decode: vi.fn(async (_blob, width) => ({ data: new Uint8Array(width * width / 2), width, height: width / 2 })), terminate: vi.fn() });
  it('loads into the shared uniform; ready 1; worker terminated; status ready with the label', async () => {
    const dec = decoder(); const onStatus = vi.fn();
    const mask = loadCoastMask({ THREE, touch: true, fetchImpl: vi.fn(async () => ok()), decoder: dec, onStatus });
    expect(mask.ready.value).toBe(0);
    await mask.done;
    expect(dec.decode).toHaveBeenCalledWith(expect.any(Blob), 4096);
    expect(mask.ready.value).toBe(1);
    expect([mask.uniform.value.image.width, mask.uniform.value.image.height]).toEqual([4096, 2048]);
    expect(mask.uniform.value.flipY).toBe(false);
    expect(dec.terminate).toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready', label: COAST_LABEL, width: 4096 }));
    mask.dispose();
    expect(mask.getStatus().state).toBe('disposed');
  });
  it('a failure leaves MOD44W (ready 0) and an identifiable fallback: label + secondary reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mask = loadCoastMask({ THREE, fetchImpl: vi.fn(async () => ({ ok: false, status: 404 })), decoder: decoder() });
    await mask.done;
    warn.mockRestore();
    expect(mask.ready.value).toBe(0);
    expect(mask.getStatus()).toMatchObject({ state: 'unavailable', label: COAST_FALLBACK_LABEL });
    expect(earthRuntimeState({ coast: mask.getStatus() }).secondary).toContain(EARTH_RUNTIME_REASONS.coastMask);
    expect(EARTH_RUNTIME_REASONS.coastMask).toBe('coast-mask-fallback');
    expect(earthRuntimeState({ coast: { state: 'ready' } }).secondary).not.toContain('coast-mask-fallback');
  });
  it('DESTROYED_IS_TERMINAL: dispose during the load aborts the fetch; a late decode is dropped', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const dec = { decode: vi.fn(async () => { await gate; return { data: new Uint8Array(8), width: 4, height: 2 }; }), terminate: vi.fn() };
    let seenSignal = null;
    const mask = loadCoastMask({ THREE, fetchImpl: vi.fn(async (_u, { signal }) => { seenSignal = signal; return ok(); }), decoder: dec, onStatus: vi.fn() });
    await new Promise((r) => setTimeout(r, 0));
    mask.dispose();
    expect(seenSignal.aborted).toBe(true);
    release(); await mask.done;
    expect(mask.ready.value).toBe(0);
    expect(mask.getStatus().state).toBe('disposed');
    expect(dec.terminate).toHaveBeenCalled();
  });
  it('the parent signal (earth layers) aborts the load as well', async () => {
    const parent = new AbortController(); let seen = null;
    const mask = loadCoastMask({ THREE, signal: parent.signal, fetchImpl: vi.fn(async (_u, { signal }) => { seen = signal; return new Promise(() => {}); }), decoder: decoder() });
    await new Promise((r) => setTimeout(r, 0));
    parent.abort();
    expect(seen.aborted).toBe(true);
    mask.dispose();
  });
  it('relief title: Natural Earth coastline once ready; MOD44W while loading or as a declared fallback', () => {
    expect(linearReliefLabel(10, 30, { state: 'ready', label: COAST_LABEL })).toContain('Coastline: Natural Earth 10m land v5.1.1 (public domain), rasterized locally; inland water MODIS MOD44W;');
    expect(linearReliefLabel(10, 30, { state: 'loading' })).toBe(linearReliefLabel());
    expect(linearReliefLabel(10, 30, { state: 'unavailable', label: COAST_FALLBACK_LABEL })).toContain('water mask MODIS MOD44W (Coastline: MODIS MOD44W 1/6° water fraction (Natural Earth coast field unavailable — fallback))');
  });
  it('earth-layers owns the mask: created with the renderer limit, passed to both materials, disposed with the layers', () => {
    const layers = text('src/earth/earth-layers.js');
    expect(layers).toContain('maxTextureSize: renderer.capabilities?.maxTextureSize ?? 16384,');
    expect(layers).toContain('const reliefMaterialOptions = { waterMask: earthWaterMask, coastMask, reliefExaggeration, shadingGain };');
    expect(layers).toContain('coastMask.dispose(); // LOT 43: fetch, worker, texture');
    expect(text('src/earth/coast-mask-worker.js')).toContain("import { decodeCoastField } from './coast-mask.js';");
  });
});
