// LOT 46: the interpretive material layer off by default and declared; the offline surface texts say what is on screen.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from '../lib/three@0.185.1/build/three.module.js';
import { SURFACE_MESO_DEFINE, createEarthMaterial, createEarthMaterialPBR, setSurfaceMesoDefine } from '../src/earth/earth-material.js';
import { INTERPRETIVE_MATERIAL_SOURCE, createSurfaceMaterialLodConfig, describeInterpretiveMaterial, interpretiveMaterialStatusText } from '../src/earth/surface-material-lod.js';
import { REGIONAL_LABEL, describeRegionalStatus } from '../src/earth/gibs-regional-surface.js';
import { describeTerrainStatus } from '../src/earth/terrarium-relief.js';
import { surfaceStatus } from '../src/earth/gibs-surface.js';
import { EARTH_RUNTIME_REASONS, earthRuntimeState } from '../src/earth/earth-runtime-state.js';
import { composeProvenanceStatus } from '../src/earth/temporal-provenance.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fakeShader = () => ({
  uniforms: {},
  vertexShader: '#include <common>\n#include <begin_vertex>\n#include <displacementmap_vertex>\n#include <worldpos_vertex>\n',
  fragmentShader: '#include <common>\n#include <map_fragment>\n#include <specularmap_fragment>\n#include <normal_fragment_maps>\n#include <opaque_fragment>\n',
});
// The fragment shader with the SURFACE_MESO_TW blocks removed: what the GPU compiles when the layer is off.
const withoutMeso = (source) => source.replace(new RegExp(`#ifdef ${SURFACE_MESO_DEFINE}[\\s\\S]*?#endif`, 'g'), '');
const tex = new THREE.Texture();

describe('LOT 46: the interpretive material layer is off by default', () => {
  it.each([
    ['Phong', (sm) => createEarthMaterial({ THREE, earthMap: tex, earthSpecular: tex, earthRelief: tex, surfaceMaterial: sm })],
    ['PBR', (sm) => createEarthMaterialPBR({ THREE, earthMap: tex, earthRoughnessMap: tex, earthRelief: tex, surfaceMaterial: sm })],
  ])('%s: default -> no define, the meso code and its uniforms are not compiled (not a factor 0)', (name, build) => {
    const material = build(createSurfaceMaterialLodConfig());
    expect(Object.hasOwn(material.defines || {}, SURFACE_MESO_DEFINE)).toBe(false);
    const shader = fakeShader();
    material.onBeforeCompile(shader);
    const off = withoutMeso(shader.fragmentShader);
    expect(off).not.toMatch(/Meso|surfaceMaterialSignalTw|uSurfaceMaterialPhongSpecularAmplitudeTw|uSurfaceMaterialPbrRoughnessAmplitudeTw/);
    expect(shader.uniforms.uSurfaceMaterialMesoEnabledTw).toBeUndefined();
    const on = build(createSurfaceMaterialLodConfig({ mode: 'on' }));
    expect(on.defines[SURFACE_MESO_DEFINE]).toBe('');
    // with the layer on, the LOT 2.4B response is in the program
    expect(shader.fragmentShader).toContain(`#ifdef ${SURFACE_MESO_DEFINE}`);
    expect(shader.fragmentShader).toContain(name === 'Phong' ? 'specularStrength *= 1.0 - surfaceMesoTw * uSurfaceMaterialPhongSpecularAmplitudeTw *' : 'roughnessFactor += surfaceMesoTw * uSurfaceMaterialPbrRoughnessAmplitudeTw');
    if (name === 'PBR') expect(off).toContain('roughnessFactor = clamp(roughnessFactor, uSurfaceMaterialPbrRoughnessMinTw, uSurfaceMaterialPbrRoughnessMaxTw);');
  });
  it('toggling sets / removes the define and asks for a recompile; the same state twice changes nothing', () => {
    const m = new THREE.MeshPhongMaterial();
    const v0 = m.version;
    setSurfaceMesoDefine(m, true);
    expect(m.defines[SURFACE_MESO_DEFINE]).toBe('');
    expect(m.version).toBe(v0 + 1);
    setSurfaceMesoDefine(m, true);
    expect(m.version).toBe(v0 + 1);
    setSurfaceMesoDefine(m, false);
    expect(Object.hasOwn(m.defines, SURFACE_MESO_DEFINE)).toBe(false);
    expect(m.version).toBe(v0 + 2);
  });
  it('the page: the toggle starts off, not persisted; earth-layers drives both materials (the export draws the same ones)', () => {
    const html = text('earth-eonet-relief.html');
    expect(html).toContain('<button id="interpretiveMaterialBtn" type="button" aria-pressed="false"');
    expect(html).toContain('>Interpretive material: off</button>');
    expect(html).toContain('<div id="interpretiveMaterialStatus" data-state="off">Interpretive material: off</div>');
    const layers = text('src/earth/earth-layers.js');
    expect(layers).toContain("let interpretiveMaterialOn = surfaceMaterial.mode === 'on';");
    expect(layers).toContain('for (const material of [earthMat, earthMatPBR]) setSurfaceMesoDefine(material, interpretiveMaterialOn);');
    expect(layers).toContain('setSurfaceMesoDefine(earthMatPBR, interpretiveMaterialOn); // LOT 46: the current layer state');
    expect(layers).not.toMatch(/localStorage|sessionStorage/);
    expect(text('src/earth/control-panel.js')).toContain("byId('interpretiveMaterialBtn')?.addEventListener('click', () => {");
    expect(text('src/earth/export-system.js')).toContain('exportComposer.addPass(new RenderPass(scene, exportCamera));');
  });
});

describe('LOT 46: the layer is declared when on', () => {
  it('status texts: what it does, where, not geography; the surface line carries it only when on', () => {
    expect(interpretiveMaterialStatusText(false)).toBe('Interpretive material: off');
    expect(interpretiveMaterialStatusText(true)).toBe('Interpretive material: on — procedural roughness / specular variation on land, full below camera distance 4.7, fading out to 6; not geography');
    expect(describeInterpretiveMaterial(false)).toBe('');
    expect(describeInterpretiveMaterial(true)).toBe(' · interpretive material on (procedural roughness / specular on land, not geography)');
    expect(text('src/earth/earth-layers.js')).toContain('${describeTerrainStatus(terrainStatus)}${describeInterpretiveMaterial(interpretiveMaterialOn)}`;');
  });
  it('the provenance label comes from the registry: interpretive', () => {
    const composed = composeProvenanceStatus(INTERPRETIVE_MATERIAL_SOURCE, interpretiveMaterialStatusText(true));
    expect(composed.message).toMatch(/^Interpretive · Interpretive material: on — /);
    const src = SOURCE_DEFINITIONS.interpretiveMaterial;
    expect(src.provenance).toBe('interpretive');
    expect(src.provenanceNote).toContain('Procedural material response, not geography and not measured');
    expect(src.provenanceNote).toContain('full below camera distance 4.7, fading out to 6.0; off by default');
    expect(OBSERVATORY_REGISTRY.find((o) => o.id === 'living-earth').sources).toContain('interpretiveMaterial');
  });
});

describe('LOT 46: the offline surface texts say what is on screen', () => {
  const regional = (state) => ({ state, level: 5, wanted: 29, resident: state === 'partial' ? 20 : 0, failed: state === 'partial' ? 9 : 29 });
  it('imagery missing, GIBS z3 on the globe: "z3 shown"', () => {
    expect(describeRegionalStatus(regional('unavailable'), 'z3')).toBe(' · regional detail z5 unavailable (29 tiles failed) — z3 shown');
    expect(describeRegionalStatus(regional('partial'), 'z3')).toBe(` · regional detail z5: 9 of 29 tiles unavailable — z3 shown there; ${REGIONAL_LABEL}`);
  });
  it('no GIBS at all: "local fallback texture shown", matching the base line', () => {
    expect(surfaceStatus({ kind: 'unavailable', retrying: true }).message).toBe('Surface: bundled fallback texture active — NASA GIBS WMTS unavailable; retrying in the background');
    expect(describeRegionalStatus(regional('unavailable'), 'local fallback texture')).toBe(' · regional detail z5 unavailable (29 tiles failed) — local fallback texture shown');
    expect(describeRegionalStatus(regional('partial'), 'local fallback texture')).toContain('— local fallback texture shown there;');
  });
  it('relief missing: "ETOPO shown" (a local asset, always there)', () => {
    expect(describeTerrainStatus({ state: 'unavailable', level: 6, wanted: 75, resident: 0, failed: 75 })).toContain('relief detail z6 unavailable (75 tiles failed) — ETOPO shown');
  });
  it('the base follows the surface events: preview / settled -> z of the level, still-loading / unavailable -> local fallback texture', () => {
    const layers = text('src/earth/earth-layers.js');
    expect(layers).toContain("if ((event.kind === 'preview' || event.kind === 'settled') && Number.isFinite(event.z)) surfaceBase = `z${event.z}`;");
    expect(layers).toContain("else if (event.kind === 'still-loading' || event.kind === 'unavailable') surfaceBase = 'local fallback texture';");
    expect(layers).toContain('${describeRegionalStatus(regionalStatus, surfaceBase)}');
  });
  it('states: missing tiles are secondary (LIVE); after the 60 s grace the missing base surface is FALLBACK', () => {
    const base = { relief: 'ktx2', sun: 'astronomy-engine', eonet: { state: 'live' }, sky: 'MAP + STARS' };
    const before = earthRuntimeState({ ...base, surface: { kind: 'settled' }, regional: { state: 'unavailable' }, terrain: { state: 'unavailable' }, elapsedMs: 5000 });
    expect(before.state).toBe('live');
    expect(before.secondary).toEqual([EARTH_RUNTIME_REASONS.surfaceDetail, EARTH_RUNTIME_REASONS.reliefDetail]);
    const offline = earthRuntimeState({ ...base, surface: { kind: 'unavailable' }, regional: { state: 'unavailable' }, terrain: { state: 'unavailable' }, elapsedMs: 61000 });
    expect(offline.state).toBe('fallback');
    expect(offline.reasons).toContain(EARTH_RUNTIME_REASONS.surface);
    expect(offline.secondary).toEqual(expect.arrayContaining([EARTH_RUNTIME_REASONS.surfaceDetail, EARTH_RUNTIME_REASONS.reliefDetail]));
  });
});
