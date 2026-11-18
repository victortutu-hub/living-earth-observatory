// LOT 15b — the real sky of Living Himalaya and the shared sky layer.
//   * Earth unchanged after the move to src/core/sky/sky-layer.js: shaders, flags, uniforms,
//     rotation matrix and star attributes against tests/fixtures/earth-real-sky-golden.json
//     (captured in the browser BEFORE the move, tmp/lot15b/lot15b-earth.mjs).
//   * Local horizon frame against astronomy-engine (tests/fixtures/sky-horizon-golden.json,
//     tmp/lot15b/lot15b-astro.mjs): Everest and K2, 3 dates.
//   * Patat 2006 twilight fit, Kasten & Young airmass, extinction, residual dark sky,
//     exposure (monotonic, bounded) and the unchanged Lot 15 photometric scale.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEG, apply, equatorToHorizonApprox, horizonToAltAz, horizonToScene, multiply, normalize, raDecToVector, skyToHorizonScene, transpose, cubeFaceDirection,
} from '../src/core/sky/sky-frame.js';
import {
  MAG0_CDM2, MAP_TO_CDM2, SKY_ATMOSPHERE_GLSL, SKY_MODEL, atmosphereRgb, cdm2ToMag, darkResidualCdm2, darkSkyFactor, exposureFor, extinctionV,
  kastenYoungAirmass, ksAirmass, magToCdm2, patatTwilightMu, preethamParams, preethamSkyRgb, pressureIsaHpa, sceneDirection, skyState, toneMap, twilightExcessCdm2,
} from '../src/core/sky/sky-atmosphere.js';
import { SKY_BACKGROUND_FRAG, SKY_BACKGROUND_VERT, SKY_STAR_FRAG, SKY_STAR_VERT, buildStarAttributes } from '../src/core/sky/sky-layer.js';
import { createRealSky } from '../src/earth/real-sky.js';
import { HIMALAYA_SKY_NOTES, skyAttribution, skyBarSegment } from '../src/himalaya/himalaya-sky.js';
import { localBasis } from '../src/himalaya/projection.js';
import { readSkyCubeKtx2 } from '../src/core/sky/sky-ktx2.js';
import { decodeSkyValue } from '../src/core/sky/sky-encoding.js';
import { SKY_MAP_ASSET } from '../src/config/sky-map.js';
import { SKY_STARS_ASSET } from '../src/config/sky-stars.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const text = (p) => read(p).toString('utf8');
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const earthGolden = JSON.parse(text('tests/fixtures/earth-real-sky-golden.json'));
const skyGolden = JSON.parse(text('tests/fixtures/sky-astronomy-golden.json'));
const horizonGolden = JSON.parse(text('tests/fixtures/sky-horizon-golden.json'));
const CENTER = { lat: 31.5, lon: 81 };
const angleDeg = (a, b) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / DEG;
const wrap = (d) => ((d + 540) % 360) - 180;

// --- minimal three.js stand-in: enough for the sky layer to build its objects without WebGL.
function fakeThree() {
  class Matrix3 { constructor() { this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1]; } set(a, b, c, d, e, f, g, h, i) { this.elements = [a, d, g, b, e, h, c, f, i]; return this; } toArray() { return [...this.elements]; } }
  class Matrix4 { constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; } }
  class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
  class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }
  class Color { constructor(hex) { this.hex = hex; } }
  class Attribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; } }
  class Float32BufferAttribute extends Attribute { constructor(values, itemSize) { super(new Float32Array(values), itemSize); } }
  class BufferGeometry { constructor() { this.attributes = {}; } setAttribute(name, attribute) { this.attributes[name] = attribute; } dispose() { this.disposed = true; } }
  class ShaderMaterial { constructor(params) { Object.assign(this, { side: 0, blending: 1, transparent: false, depthTest: true, depthWrite: true }, params); this.type = 'ShaderMaterial'; } dispose() { this.disposed = true; } }
  class Object3D { constructor(geometry, material) { Object.assign(this, { geometry, material, renderOrder: 0, visible: true, frustumCulled: true, userData: {} }); } }
  class Mesh extends Object3D { constructor(...a) { super(...a); this.type = 'Mesh'; } }
  class Points extends Object3D { constructor(...a) { super(...a); this.type = 'Points'; } }
  return { Matrix3, Matrix4, Vector2, Vector3, Color, BufferGeometry, Float32BufferAttribute, BufferAttribute: Attribute, ShaderMaterial, Mesh, Points, AdditiveBlending: 2 };
}
const fakeScene = () => ({ children: [], add(...o) { this.children.push(...o); }, remove(...o) { this.children = this.children.filter((c) => !o.includes(c)); } });

/** astronomy-engine stand-in replaying the Lot 15 reference values (precession + GAST). */
function earthAstronomy(entry) {
  const P = entry.precession;
  return {
    Rotation_EQJ_EQD: () => ({ rot: P }), MakeTime: () => null,
    Vector: function Vector(x, y, z) { Object.assign(this, { x, y, z }); },
    RotateVector: (_r, v) => { const [x, y, z] = apply(P, [v.x, v.y, v.z]); return { x, y, z }; },
    SiderealTime: () => entry.gastHours,
  };
}
/** astronomy-engine stand-in replaying Rotation_EQJ_HOR (captured rows). */
function horizonAstronomy(frame) {
  const H = frame.horizon;
  return {
    Rotation_EQJ_HOR: () => ({ rot: H }), Observer: function Observer(lat, lon, h) { Object.assign(this, { lat, lon, h }); }, MakeTime: () => null,
    Vector: function Vector(x, y, z) { Object.assign(this, { x, y, z }); },
    RotateVector: (_r, v) => { const [x, y, z] = apply(H, [v.x, v.y, v.z]); return { x, y, z }; },
  };
}

describe('LOT 15b: Living Earth sky unchanged after the move to src/core/sky/sky-layer.js', () => {
  const golden = earthGolden;
  it('shader sources are the Lot 15 strings (hashes captured before the move)', () => {
    expect(sha(SKY_BACKGROUND_VERT)).toBe(golden.background.vertexShader);
    expect(sha(SKY_BACKGROUND_FRAG)).toBe(golden.background.fragmentShader);
    expect(sha(SKY_STAR_VERT)).toBe(golden.stars.vertexShader);
    expect(sha(SKY_STAR_FRAG)).toBe(golden.stars.fragmentShader);
  });

  it('objects, materials, flags, ALL uniforms and the rotation matrix match the golden values', async () => {
    const THREE = fakeThree();
    const scene = fakeScene();
    const entry = skyGolden.dates.find((d) => d.iso === golden.date);
    const sky = createRealSky({ THREE, scene, getDate: () => new Date(golden.date), loadAstronomy: async () => earthAstronomy(entry), baseURI: 'http://127.0.0.1:9/' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    sky.update();
    try {
      for (const [object, ref] of [[sky.background, golden.background], [sky.stars, golden.stars]]) {
        expect(object.name).toBe(ref.name);
        expect(object.type).toBe(ref.type);
        expect(object.renderOrder).toBe(ref.renderOrder);
        expect(object.frustumCulled).toBe(ref.frustumCulled);
        expect(object.material.name).toBe(ref.material.name);
        for (const flag of ['depthTest', 'depthWrite', 'transparent', 'blending', 'side']) expect(object.material[flag], flag).toBe(ref.material[flag]);
        expect(sha(object.material.vertexShader)).toBe(ref.vertexShader);
        expect(sha(object.material.fragmentShader)).toBe(ref.fragmentShader);
      }
      expect(Array.from(sky.background.geometry.attributes.position.array)).toEqual(golden.background.geometry.position);
      const bg = sky.background.material.uniforms;
      const st = sky.stars.material.uniforms;
      expect(Object.keys(bg)).toEqual(Object.keys(golden.uniforms.background));
      expect(Object.keys(st)).toEqual(Object.keys(golden.uniforms.stars));
      expect(bg.uScale.value).toBe(golden.uniforms.background.uScale);
      expect(bg.uSkyToScene.value).toBe(st.uSkyToScene.value); // one shared matrix, as in Lot 15
      bg.uSkyToScene.value.toArray().forEach((v, i) => expect(v).toBeCloseTo(golden.uniforms.background.uSkyToScene[i], 12));
      sky.snapshot().matrix.forEach((v, i) => expect(v).toBeCloseTo(golden.snapshot.matrix[i], 12));
      expect(sky.snapshot().siderealHours).toBe(golden.snapshot.siderealHours);
      expect(sky.snapshot().sceneScale).toBe(golden.snapshot.sceneScale);
      expect(sky.snapshot().exposureStops).toBe(golden.snapshot.exposureStops);
      // Star uniforms: same per-frame computation for the captured camera (fov 45, 900 px, pixel ratio 1).
      const renderer = { getDrawingBufferSize: (v) => { v.x = 1600; v.y = golden.camera.drawingBufferHeight; return v; }, getPixelRatio: () => golden.camera.pixelRatio };
      sky.stars.onBeforeRender(renderer, scene, { fov: golden.camera.fovDeg });
      expect(st.uSigma.value).toBe(golden.uniforms.stars.uSigma);
      expect(st.uFluxToPixels.value).toBeCloseTo(golden.uniforms.stars.uFluxToPixels, 14);
      // uInvProjView depends only on the camera (checked in the browser before/after, see the report).
      expect(Object.keys(golden.uniforms.background)).toContain('uInvProjView');
    } finally {
      sky.dispose();
    }
    expect(scene.children).toEqual([]);
  });

  it('star attributes built from the shipped catalogue are bit-identical to the Lot 15 ones', () => {
    const buffer = read(SKY_STARS_ASSET.file);
    const records = new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    const a = buildStarAttributes(records, SKY_MAP_ASSET.calibration.zeroPoint);
    const bytes = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    expect(a.count).toBe(golden.stars.attributes.position.count);
    expect(sha(bytes(a.position))).toBe(golden.stars.attributes.position.sha256);
    expect(sha(bytes(a.color))).toBe(golden.stars.attributes.aColor.sha256);
    expect(sha(bytes(a.flux))).toBe(golden.stars.attributes.aFlux.sha256);
  });

  it('the Earth module keeps its exposure, zodiacal coupling and notes; the render code lives in core', () => {
    const earth = text('src/earth/real-sky.js');
    expect(earth).toContain("createSkyLayer({\n    THREE, scene, name: 'real-sky', skyMatrix,");
    expect(earth).toContain('onEclipticNormal(apply(matrix, ECLIPTIC_POLE_J2000))');
    expect(earth).not.toMatch(/gl_FragColor|new THREE\.ShaderMaterial|CubeTexture/);
    expect(text('src/core/sky/sky-layer.js')).not.toMatch(/Math\.random/);
  });
});

describe('LOT 15b: local horizon frame (ICRS -> N, W, Z -> scene)', () => {
  it('astronomy-engine 2.1.19 (the loaded version) has Rotation_EQJ_HOR; it is used when present', () => {
    expect(horizonGolden.hasRotationEqjHor).toBe(true);
    const f = horizonGolden.frames[0];
    const basis = localBasis(f.lon, f.lat, CENTER);
    expect(skyToHorizonScene({ date: new Date(f.iso), latDeg: f.lat, lonDeg: f.lon, heightM: f.heightM, basis, Astronomy: horizonAstronomy(f) }).source).toBe('astronomy-engine');
    expect(skyToHorizonScene({ date: new Date(f.iso), latDeg: f.lat, lonDeg: f.lon, heightM: f.heightM, basis }).source).toBe('approximate');
  });

  it('horizon matrix = astronomy-engine golden values; stars alt/az vs Astronomy.Horizon <= 0.01 deg (Everest, K2; 3 dates)', () => {
    expect(new Set(horizonGolden.frames.map((f) => f.iso)).size).toBe(3);
    for (const f of horizonGolden.frames) {
      const basis = localBasis(f.lon, f.lat, CENTER);
      const { horizon, matrix } = skyToHorizonScene({ date: new Date(f.iso), latDeg: f.lat, lonDeg: f.lon, heightM: f.heightM, basis, Astronomy: horizonAstronomy(f) });
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(horizon[i][j]).toBeCloseTo(f.horizon[i][j], 12);
      const I = multiply(matrix, transpose(matrix));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(I[i][j]).toBeCloseTo(i === j ? 1 : 0, 12);
      for (const s of f.stars) {
        const h = horizonToAltAz(apply(horizon, raDecToVector(s.raDeg, s.decDeg)));
        expect(Math.abs(h.altitudeDeg - s.altitudeDeg), `${f.observer} ${f.iso} ${s.name}`).toBeLessThan(0.01);
        if (Math.abs(s.altitudeDeg) < 89) expect(Math.abs(wrap(h.azimuthDeg - s.azimuthDeg)), s.name).toBeLessThan(0.01);
      }
    }
  });

  it('fallback without astronomy-engine (IAU 1976 precession + GMST + longitude) within 0.01 deg of the engine', () => {
    for (const f of horizonGolden.frames) {
      const approx = equatorToHorizonApprox(new Date(f.iso), f.lat, f.lon);
      for (const s of f.stars) {
        const v = raDecToVector(s.raDeg, s.decDeg);
        expect(angleDeg(apply(approx, v), apply(f.horizon, v)), s.name).toBeLessThan(0.01);
      }
    }
  });

  it('scene = N north + W (-east) + Z up: a horizontal direction lands on the projected meridian/up axes', () => {
    const basis = localBasis(86.92521, 27.98806, CENTER);
    const M = horizonToScene(basis);
    const north = apply(M, [1, 0, 0]);
    const r = Math.hypot(basis.north.x, basis.north.z);
    expect(north[0]).toBeCloseTo(basis.north.x / r, 12); expect(north[1]).toBe(0); expect(north[2]).toBeCloseTo(basis.north.z / r, 12);
    expect(apply(M, [0, 0, 1])).toEqual([0, 1, 0]);
    // East (= -W) within 0.11 deg of the projection's own east (the map is not conformal; 0.107 deg at Everest).
    const east = apply(M, [0, -1, 0]);
    expect(angleDeg(east, normalize([basis.east.x, 0, basis.east.z]))).toBeLessThan(0.11);
    // Same rule as the Sun light (sunDirectionScene): azimuth 90 deg = east.
    expect(angleDeg(sceneDirection(90, 0, basis), normalize([basis.east.x, 0, basis.east.z]))).toBeLessThan(1e-9);
  });

  it('Galactic Centre above Everest: highest possible altitude (it never reaches the zenith at 28 N) vs Astronomy.Horizon <= 0.1 deg', () => {
    const best = horizonGolden.galacticCentre.best;
    expect(best.iso).toBe('2026-06-21T18:00:00.000Z'); // found offline: 2026, Sun < -18 deg, Moon below the horizon
    expect(best.sunAltDeg).toBeLessThan(-18); expect(best.moonAltDeg).toBeLessThan(0);
    // dec -29.0 at latitude +28.0: culmination altitude 90 - |28.0 + 29.0| = 33.0 deg.
    expect(Math.abs(best.gcAltDeg - (90 - (27.98806 + 29.00781)))).toBeLessThan(0.1);
    const f = horizonGolden.frames.find((x) => x.observer === 'everest' && x.iso === best.iso);
    const basis = localBasis(f.lon, f.lat, CENTER);
    const { matrix } = skyToHorizonScene({ date: new Date(f.iso), latDeg: f.lat, lonDeg: f.lon, heightM: f.heightM, basis, Astronomy: horizonAstronomy(f) });
    const w = apply(matrix, raDecToVector(horizonGolden.galacticCentre.raDeg, horizonGolden.galacticCentre.decDeg));
    const r = Math.hypot(basis.north.x, basis.north.z); const nx = basis.north.x / r; const nz = basis.north.z / r;
    const alt = Math.asin(w[1]) / DEG;
    const az = ((Math.atan2(w[0] * -nz + w[2] * nx, w[0] * nx + w[2] * nz) / DEG) + 360) % 360;
    expect(Math.abs(alt - best.gcAltDeg)).toBeLessThan(0.1);
    expect(Math.abs(wrap(az - best.gcAzDeg))).toBeLessThan(0.1);
  });
});

describe('LOT 15b: sky brightness models (V band)', () => {
  it('Patat et al. 2006 Table 1 V coefficients (a2 negative, verified on the table) reproduce the fit', () => {
    expect(SKY_MODEL.twilight).toMatchObject({ a0: 11.84, a1: 1.518, a2: -0.057, sigmaMag: 0.18, zetaMin: 95, zetaMax: 105 });
    expect(patatTwilightMu(95)).toBeCloseTo(11.84, 10);
    expect(patatTwilightMu(100)).toBeCloseTo(11.84 + 1.518 * 5 - 0.057 * 25, 10);
    expect(patatTwilightMu(105)).toBeCloseTo(21.32, 10); // close to the dark-sky 21.6: night level at 105-106 deg
    for (let z = 95; z < 105; z += 0.5) expect(patatTwilightMu(z + 0.5)).toBeGreaterThan(patatTwilightMu(z)); // darker as the Sun sinks
    expect(twilightExcessCdm2(106)).toBe(0);
    expect(twilightExcessCdm2(105.5)).toBeCloseTo(twilightExcessCdm2(105) / 2, 15);
  });

  it('Kasten & Young 1989: X(0) = 1, X(60) ~ 2, X(90) ~ 38; K&S scattered-light airmass X(90) = 5', () => {
    expect(kastenYoungAirmass(0)).toBeCloseTo(1, 3);
    expect(kastenYoungAirmass(60)).toBeCloseTo(2, 1);
    expect(Math.abs(kastenYoungAirmass(90) - 38)).toBeLessThan(0.2);
    expect(ksAirmass(0)).toBe(1);
    expect(ksAirmass(90)).toBeCloseTo(5, 10);
    expect(darkSkyFactor(0, 0.075)).toBe(1);
  });

  it('extinction: Buton et al. 2013 at 5500 A, Rayleigh scaled by the ISA pressure; ~0.075 at Everest', () => {
    expect(SKY_MODEL.extinction).toMatchObject({ rayleigh: 0.064, ozone: 0.024, aerosol: 0.018, referenceHpa: 616, wavelengthA: 5500 });
    expect(pressureIsaHpa(0)).toBeCloseTo(1013.25, 6);
    expect(Math.abs(pressureIsaHpa(8848.86) - 314.5)).toBeLessThan(1);
    expect(extinctionV(8848.86)).toBeCloseTo(0.0747, 3);
    expect(Math.abs(extinctionV(4205) - 0.106)).toBeLessThan(0.003); // Mauna Kea itself: Buton total 0.106
    expect(extinctionV(5000)).toBeGreaterThan(extinctionV(8611));
  });

  it('dark sky: Patat 2003 V 21.6 minus the SVS map starlight at |b| > 60 deg, recomputed from the shipped cube', () => {
    const buffer = read(SKY_MAP_ASSET.luminance.file);
    const zstd = { decode: (data) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) };
    const cube = readSkyCubeKtx2(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), zstd);
    const level = cube.levels[2]; const n = level.size; // 256^2 per face is enough for a mean over ~2 sr
    const ngp = raDecToVector(192.85948, 27.12825);
    let sum = 0; let weight = 0;
    for (let f = 0; f < 6; f++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const d = cubeFaceDirection(f, (i + 0.5) / n, (j + 0.5) / n);
      const r2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      const v = normalize(d);
      if (Math.abs(v[0] * ngp[0] + v[1] * ngp[1] + v[2] * ngp[2]) <= Math.sin(60 * DEG)) continue;
      const w = 1 / (r2 * Math.sqrt(r2));
      sum += w * decodeSkyValue(level.faces[f][j * n + i]); weight += w;
    }
    const mu = -2.5 * Math.log10(sum / weight) + SKY_MAP_ASSET.surfaceBrightness.K;
    expect(Math.abs(mu - SKY_MODEL.svsHighLatitudeV)).toBeLessThan(0.05);
    expect(cdm2ToMag(darkResidualCdm2())).toBeCloseTo(21.876, 2);
    // Night zenith (no map) + map starlight = Patat 2003 again (no double counting).
    expect(cdm2ToMag(darkResidualCdm2() + magToCdm2(SKY_MODEL.svsHighLatitudeV))).toBeCloseTo(21.6, 10);
  });

  it('the Lot 15 photometric scale is unchanged: map -> cd/m^2 = yToCdm2, stars with the same zero point, no extra gain', () => {
    expect(MAP_TO_CDM2).toBe(SKY_MAP_ASSET.exposure.yToCdm2);
    expect(magToCdm2(SKY_MAP_ASSET.surfaceBrightness.K) / SKY_MAP_ASSET.exposure.yToCdm2).toBeCloseTo(1, 4);
    expect(MAG0_CDM2).toBe(108000);
    const src = text('src/himalaya/himalaya-sky.js');
    expect(src).toContain('uMapToCdm2: { value: MAP_TO_CDM2 }');
    expect(src).toContain('map = value * uMapToCdm2 * pow(10.0, -0.4 * uK * lumiKastenYoung(cz));');
    expect(src).toContain('vec3 L = (atmosphere + map) * uExposure;');
    expect(src).toContain('(MAP_TO_CDM2 * texelSolidAngle * (state.model?.exposure ?? 0))');
    expect(src).toContain('zeroPoint: SKY_MAP_ASSET.calibration.zeroPoint');
  });

  it('exposure: E = 0.18 / L_ref, monotonic as the Sun sinks and limited to [E_min, E_max]', () => {
    const basis = localBasis(86.92521, 27.98806, CENTER);
    let previous = 0;
    for (let alt = 70; alt >= -40; alt -= 0.5) {
      const s = skyState({ sunAzimuthDeg: 250, sunAltitudeDeg: alt, heightM: 8848.86, basis });
      expect(s.exposure, `sun ${alt}`).toBeGreaterThanOrEqual(previous * (1 - 1e-12));
      expect(s.exposure).toBeLessThanOrEqual(SKY_MODEL.exposure.eMax);
      expect(s.exposure).toBeGreaterThanOrEqual(SKY_MODEL.exposure.eMin);
      previous = s.exposure;
    }
    expect(exposureFor(1e-9)).toBe(SKY_MODEL.exposure.eMax);
    expect(exposureFor(1e12)).toBe(SKY_MODEL.exposure.eMin);
    expect(exposureFor(1)).toBeCloseTo(0.18, 12);
    expect(SKY_MODEL.exposure.eMaxCandidates).toEqual([15, 50, 150]);
    expect(SKY_MODEL.exposure.eMax).toBe(50); // middle candidate; final since LOT 18 (tests/himalaya-lot18.test.js)
  });

  it('regimes and continuity: day (Preetham) -> transition 0..-5 -> twilight fit -> night; no jumps at the joins', () => {
    const basis = localBasis(86.92521, 27.98806, CENTER);
    const at = (alt) => skyState({ sunAzimuthDeg: 250, sunAltitudeDeg: alt, heightM: 8848.86, basis });
    expect([10, -2, -8, -20].map((a) => at(a).regime)).toEqual(['day', 'transition', 'twilight', 'night']);
    for (const join of [0, -5, -16]) expect(at(join - 1e-6).referenceCdm2 / at(join + 1e-6).referenceCdm2).toBeCloseTo(1, 4);
    // Zenith with the Sun on the horizon = the twilight fit continued linearly to zeta 90 (a0 - 5 a1).
    const z = atmosphereRgb([0, 1, 0], at(0));
    expect(0.2126 * z[0] + 0.7152 * z[1] + 0.0722 * z[2]).toBeCloseTo(magToCdm2(11.84 - 5 * 1.518), 6);
    // At zeta 95 the transition reaches the observed fit (zenith, achromatic); the map's own starlight is
    // drawn separately per direction, so the atmosphere term is the fit minus the mean starlight.
    const t = atmosphereRgb([0, 1, 0], at(-5));
    expect(t[0]).toBeCloseTo(magToCdm2(11.84) - magToCdm2(SKY_MODEL.svsHighLatitudeV), 9); expect(t[2]).toBeCloseTo(t[0], 12);
    // Night zenith = the residual dark sky.
    expect(atmosphereRgb([0, 1, 0], at(-30))[1]).toBeCloseTo(darkResidualCdm2(), 15);
  });

  it('day model: Rayleigh scaled by P(h)/P0; blue zenith; tone curve maps mid grey and stays below 1', () => {
    const sun = sceneDirection(180, 40, localBasis(86.92521, 27.98806, CENTER));
    const high = preethamParams(sun, 8848.86); const low = preethamParams(sun, 0);
    expect(high.betaR[1] / low.betaR[1]).toBeCloseTo(pressureIsaHpa(8848.86) / 1013.25, 12);
    expect(high.betaM).toEqual(low.betaM);
    const zenith = preethamSkyRgb([0, 1, 0], low);
    expect(zenith[2]).toBeGreaterThan(zenith[0]);
    const grey = toneMap([0.18, 0.18, 0.18]);
    expect(grey[0]).toBeCloseTo(0.18 / 1.18, 12);
    expect(toneMap([1e6, 1e6, 1e6])[0]).toBeLessThan(1);
  });

  it('GLSL mirrors the JS constants (Kasten & Young, K&S airmass, Preetham phase constants)', () => {
    expect(SKY_ATMOSPHERE_GLSL).toContain('0.50572 * pow(96.07995 - zDeg, -1.6364)');
    expect(SKY_ATMOSPHERE_GLSL).toContain('inversesqrt(1.0 - 0.96 * (1.0 - cz * cz))');
    expect(SKY_ATMOSPHERE_GLSL).toContain('float g = 0.8;');
    expect(SKY_ATMOSPHERE_GLSL).toContain('return Lin * 0.04;');
    expect(SKY_ATMOSPHERE_GLSL).not.toMatch(/\bflat\b/); // reserved word in GLSL ES 3.0
  });
});

describe('LOT 15b: Living Himalaya sky integration, provenance and registry', () => {
  it('render order and lighting: sky first, background only; terrain lights and clear colour untouched', () => {
    const layer = text('src/core/sky/sky-layer.js');
    expect(layer).toContain('background.renderOrder = -1000;');
    expect(layer).toContain('depthTest: false, depthWrite: false,');
    const scene = text('src/himalaya/himalaya-scene.js');
    expect(scene).toContain('const sky = new THREE.HemisphereLight(0x9cc7ff, 0x1a1c22, 0.32);');
    expect(scene).toContain("const realSky = createHimalayaSky({ THREE, scene, groundColor: CLEAR_COLOR });");
    expect(scene).toContain('renderer.setClearColor(CLEAR_COLOR, 1);');
    expect(scene).toContain('const CLEAR_COLOR = 0x03060d;');
    expect(scene).not.toMatch(/toneMapping\s*=/);
    const sky = text('src/himalaya/himalaya-sky.js');
    expect(sky).not.toMatch(/fetch\(/); // assets through the shared runtime (sky-assets.js)
    expect(text('src/core/sky/sky-assets.js')).toContain('createRequestRuntime({ cache: NON_PERSISTENT_CACHE })');
  });

  it('provenance bar segment and sources entry declare every model choice; the Moon note is explicit', () => {
    expect(skyBarSegment({ status: 'MAP + STARS', map: true, stars: true, regime: 'night', k: 0.0747 })).toBe('Sky: night — observed (NASA SVS Milky Way + HYG stars, extinction k 0.075)');
    expect(skyBarSegment({ status: 'STARS ONLY', map: false, stars: true, regime: 'night', k: 0.0747 })).toMatch(/HYG stars; Milky Way map unavailable/);
    expect(skyBarSegment({ status: 'MAP + STARS', map: true, stars: true, regime: 'twilight', k: 0.0747 })).toMatch(/observed empirical fit \(Patat et al\. 2006, Paranal, extrapolated to altitude\)/);
    expect(skyBarSegment({ status: 'MAP + STARS', map: true, stars: true, regime: 'transition' })).toMatch(/interpretive transition/);
    expect(skyBarSegment({ status: 'MAP + STARS', map: true, stars: true, regime: 'day' })).toMatch(/interpretive \(Preetham model, non-photometric\)/);
    expect(skyBarSegment({ status: 'UNAVAILABLE', map: false, stars: false })).toBe('Sky: unavailable (plain background)');
    const note = skyAttribution({ k: 0.0747 }).note;
    for (const part of ['Night: observed', 'k = 0.075 mag/airmass', 'Buton et al. 2013', 'Twilight (Sun −5° to −16°): observed', 'extrapolated to altitude', 'Sun 0° to −5°: interpretive',
      'Day: interpretive', 'mid grey at 45°', 'E_max = 50', 'refraction ignored', 'does not light the terrain']) expect(note, part).toContain(part);
    expect(HIMALAYA_SKY_NOTES.moon).toBe('Moonlight on the sky not modelled — with a bright Moon the Milky Way would be fainter than shown.');
    expect(note).toContain(HIMALAYA_SKY_NOTES.moon);
    expect(skyAttribution({ note: HIMALAYA_SKY_NOTES.mapUnavailable }).note).toContain(HIMALAYA_SKY_NOTES.mapUnavailable);
  });

  it('source registry: night and twilight observed, transition and day interpretive; declared by the observatory', () => {
    expect(SOURCE_DEFINITIONS.himalayaSkyNight.provenance).toBe('observed');
    expect(SOURCE_DEFINITIONS.himalayaSkyTwilight.provenance).toBe('observed');
    expect(SOURCE_DEFINITIONS.himalayaSkyTransition.provenance).toBe('interpretive');
    expect(SOURCE_DEFINITIONS.himalayaSkyDay.provenance).toBe('interpretive');
    expect(SOURCE_DEFINITIONS.himalayaSkyTwilight.provenanceNote).toMatch(/- 0\.057 \(zeta - 95\)\^2/);
    expect(SOURCE_DEFINITIONS.himalayaSkyTwilight.provenanceNote).toMatch(/extrapolated to altitude/);
    expect(SOURCE_DEFINITIONS.himalayaSkyNight.provenanceNote).toMatch(/Moonlight on the sky not modelled/);
    expect(SOURCE_DEFINITIONS.himalayaSkyDay.provenanceNote).toMatch(/not photometric/);
    const himalaya = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya');
    for (const id of ['himalayaSkyNight', 'himalayaSkyTwilight', 'himalayaSkyTransition', 'himalayaSkyDay']) expect(himalaya.sources).toContain(id);
  });

  it('criterion 10 done (LOT 15b); since LOT 20 all 11 criteria are done', () => {
    const himalaya = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya');
    expect(himalaya.roadmap.criteria.find((c) => c.id === 'night-sky')).toEqual({ id: 'night-sky', label: 'Real night sky (Lot 15b)', done: true });
    expect(himalaya.roadmap.criteria.filter((c) => c.done)).toHaveLength(11);
    expect(himalaya.roadmap.progress).toBe(100);
  });

  it('NOTICE credits the Preetham sky code from three.js (MIT)', () => {
    const notice = text('NOTICE.md');
    expect(notice).toMatch(/Sky\.js/);
    expect(notice).toMatch(/three\.js/);
    expect(notice).toMatch(/MIT/);
    expect(notice).toMatch(/Preetham/);
  });
});
