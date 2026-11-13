import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    ATMOSPHERE,
    ATMOSPHERE_GLSL,
    chapman,
    surfaceToCameraTransmittance,
    transmittanceBetween,
} from '../src/earth/atmosphere-physics.js';
import {
    AERIAL_PERSPECTIVE_UNIFORMS,
    RELIEF_STRENGTH,
    RELIEF_TERMINATOR_EDGES,
    createEarthMaterial,
    createEarthMaterialPBR,
    reliefPerturbationWeight,
} from '../src/earth/earth-material.js';
import * as earthMaterial from '../src/earth/earth-material.js';
import { makeNightLightsMat } from '../src/earth/night-lights.js';
import { makeAtmosphereMat } from '../src/earth/atmosphere.js';

// Minimal stand-in for the parts of three.js these factories touch (three is
// loaded from a CDN import map in the browser, not installed for tests).
class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
class Color { constructor(value) { this.value = value; } }
class Material { constructor(params = {}) { Object.assign(this, params); this.userData = {}; } }
const THREE = {
    Vector2, Vector3, Color,
    MeshPhongMaterial: class extends Material {},
    MeshStandardMaterial: class extends Material {},
    ShaderMaterial: class extends Material {},
    AdditiveBlending: 2, BackSide: 1,
};
const texture = { userData: {} };

function fakeShader() {
    return {
        uniforms: {},
        vertexShader: '#include <common>\n#include <begin_vertex>\n#include <displacementmap_vertex>\n#include <worldpos_vertex>\n',
        fragmentShader: '#include <common>\n#include <map_fragment>\n#include <specularmap_fragment>\n#include <normal_fragment_maps>\n#include <opaque_fragment>\n',
    };
}

const R = ATMOSPHERE.earthRadiusM;
const KM = 1000;

describe('atmosphere physics (JS mirror of the GLSL library)', () => {
    it('Chapman function: vertical column is 1 and the two branches meet at the horizon', () => {
        const X = R / ATMOSPHERE.rayleighScaleHeightM;
        expect(chapman(X, 1)).toBeCloseTo(1, 10);
        expect(chapman(X, 0)).toBeCloseTo(Math.sqrt(Math.PI * X / 2), 6);
        expect(chapman(X, -1e-6)).toBeCloseTo(chapman(X, 1e-6), 1);
        expect(chapman(X, -0.6)).toBe(1e9); // deep below the horizon: opaque
    });

    it('view transmittance decreases monotonically from nadir to the limb', () => {
        // Scene units, outside the atmosphere. From 3.6 units the visible cap ends
        // at acos(2 / 3.6) = 56.3 deg from the sub-camera point (the limb).
        const camera = [0, 0, 3.6];
        const angles = [0, 15, 30, 45, 52, 55];
        const blue = angles.map((deg) => {
            const rad = deg * Math.PI / 180;
            return surfaceToCameraTransmittance([Math.sin(rad) * 2, 0, Math.cos(rad) * 2], camera)[2];
        });
        for (let i = 1; i < blue.length; i++) expect(blue[i]).toBeLessThan(blue[i - 1]);
        expect(blue[0]).toBeGreaterThan(0.6);
        expect(blue.at(-1)).toBeLessThan(blue[0] * 0.8);
    });

    it('extinguishes blue more than red (Rayleigh)', () => {
        const [red, green, blue] = transmittanceBetween([0, 0, R + 1], [0, 0, R + 200 * KM]);
        expect(blue).toBeLessThan(green);
        expect(green).toBeLessThan(red);
    });

    it('is fully transparent without an atmosphere', () => {
        const none = { betaRayleigh: [0, 0, 0], betaMie: 0 };
        expect(transmittanceBetween([0, 0, R + 1], [0, 0, R + 500 * KM], none)).toEqual([1, 1, 1]);
        // Two points far above the atmosphere: the column between them is ~0.
        const above = transmittanceBetween([0, 0, R + 2000 * KM], [0, 1000 * KM, R + 3000 * KM]);
        above.forEach((value) => expect(value).toBeCloseTo(1, 6));
    });

    it('emits the same constants into GLSL as the JS model uses', () => {
        expect(ATMOSPHERE_GLSL).toContain('const float R_E = 6371000.0;');
        expect(ATMOSPHERE_GLSL).toContain('const float H_R = 7994.0;');
        expect(ATMOSPHERE_GLSL).toContain('const float H_M = 1200.0;');
        expect(ATMOSPHERE_GLSL).toContain('const vec3 BETA_R = vec3(0.0000058, 0.0000135, 0.0000331);');
        for (const fn of ['phaseR', 'phaseM', 'atmoExtinction', 'atmoChapman', 'atmoOpticalDepth', 'atmoViewTransmittance', 'atmoAerialInscatter']) {
            expect(ATMOSPHERE_GLSL).toContain(fn);
        }
    });
});

describe('relief: one shading, land only, real Sun', () => {
    it('is zero on water and full on land in daylight', () => {
        expect(reliefPerturbationWeight({ strength: 0.72, landWeight: 0, sunDotGeometric: 0.8 })).toBe(0);
        expect(reliefPerturbationWeight({ strength: 0.72, landWeight: 1, sunDotGeometric: 0.8 })).toBeCloseTo(0.72, 10);
    });

    it('keeps full relief at low Sun and fades only below the horizon', () => {
        expect(RELIEF_TERMINATOR_EDGES).toEqual([-0.05, 0.05]);
        expect(reliefPerturbationWeight({ strength: 1, landWeight: 1, sunDotGeometric: 0.05 })).toBe(1);
        expect(reliefPerturbationWeight({ strength: 1, landWeight: 1, sunDotGeometric: -0.05 })).toBe(0);
        expect(reliefPerturbationWeight({ strength: 1, landWeight: 1, sunDotGeometric: 0 })).toBeCloseTo(0.5, 10);
    });
});

describe('Earth materials', () => {
    const common = { THREE, earthMap: texture, earthSpecular: texture, earthRelief: texture };
    const waterMask = { uniform: { value: { userData: {} } }, ready: { value: 0 } };

    it.each([
        ['Phong', (extra) => createEarthMaterial({ ...common, waterMask, ...extra }), RELIEF_STRENGTH.phong],
        ['PBR', (extra) => createEarthMaterialPBR({ ...common, earthRoughnessMap: texture, waterMask, ...extra }), RELIEF_STRENGTH.pbr],
    ])('%s: linear metres x E, water flat, normals from heights, MOD44W land weight', (_name, build, strength) => {
        const material = build();
        expect(material.normalMap).toBeUndefined(); // no normal map
        expect(material.bumpMap).toBeUndefined();
        expect(material.fog).toBe(false);
        expect(material.displacementScale).toBeCloseTo(10 / ATMOSPHERE.metersPerSceneUnit, 15);
        expect(material.displacementBias).toBe(0);
        expect(material.userData.reliefSource).toMatch(/ETOPO 2022 60" ice surface .*area-averaged.*MOD44W/);
        const shader = fakeShader();
        material.onBeforeCompile(shader);
        expect(shader.uniforms.uReliefStrengthTw.value).toBe(strength);
        expect(shader.uniforms.uReliefExaggerationTw.value).toBe(10);
        // Shared uniform objects: the R8 mask swap and the ready flag reach every material.
        expect(shader.uniforms.uWaterMaskTw).toBe(waterMask.uniform);
        expect(shader.uniforms.uWaterMaskReadyTw).toBe(waterMask.ready);
        for (const name of AERIAL_PERSPECTIVE_UNIFORMS) expect(shader.uniforms[name]).toBeDefined();
        expect(shader.uniforms.uSunIrradianceTw.value).toEqual(new Vector3(0, 0, 0)); // synced from the sun light per frame
        expect(shader.uniforms.uAtmosphereHazeTw.value).toBe(ATMOSPHERE.haze);
        expect(shader.vertexShader).toContain('vWorldPosTw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        // Geometry: water clamped at 0 m, dry land below sea level kept.
        expect(shader.vertexShader).toContain('float reliefSurfaceVTw = mix( reliefHTw, max( reliefHTw, 0.0 ), reliefWaterVTw );');
        expect(shader.vertexShader).not.toContain('#include <displacementmap_vertex>');
        // Normals: 4 surface-height samples, gain E, along local east/north.
        expect(shader.fragmentShader.match(/reliefSurfaceHeightTw\(vMapUv [+-] vec2/g)).toHaveLength(4);
        expect(shader.fragmentShader).toContain('uReliefExaggerationTw * vec2(');
        expect(shader.fragmentShader).toContain('reliefSunTw = smoothstep(-0.05, 0.05');
        expect(shader.fragmentShader).toContain('surfaceLandWeightTw * reliefSunTw');
        // Land weight from the water fraction, not from a gray threshold.
        expect(shader.fragmentShader).toContain('float surfaceLandWeightTw = 1.0 - reliefWaterTw(vMapUv, surfaceReliefTw);');
        expect(shader.fragmentShader).not.toMatch(/CoastStart|uSeaLevelTw|normalMap|bathyRampTw|gradClipTw|visual-lock debug view/);
        // The aerial perspective runs once, right before the opaque output.
        expect(shader.fragmentShader.split('atmoAerialInscatter(vWorldPosTw').length - 1).toBe(1);
        expect(shader.fragmentShader.indexOf('outgoingLight * apTransmittanceTw'))
            .toBeLessThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'));
    });

    it('accepts the lock relief strength and exaggeration overrides only', () => {
        const shader = fakeShader();
        const material = createEarthMaterial({ ...common, waterMask, overrides: { reliefStrength: 0.9 }, reliefExaggeration: 0 });
        material.onBeforeCompile(shader);
        expect(shader.uniforms.uReliefStrengthTw.value).toBe(0.9);
        expect(shader.uniforms.uReliefExaggerationTw.value).toBe(0);
        expect(material.displacementScale).toBe(0);
    });

    it('no longer exports the legacy sqrt-like relief (encoding, labels, lock options)', () => {
        for (const name of ['RELIEF_ENCODING', 'EARTH_RELIEF_SCALE', 'BATHYMETRY_MIX', 'RELIEF_MODELS', 'SURFACE_DEBUG_VIEWS',
            'reliefExaggerationLabel', 'verticalExaggerationAt', 'displacementScaleForExaggeration']) {
            expect(earthMaterial[name]).toBeUndefined();
        }
    });
});

describe('relief provenance and shared shading', () => {
    it('names the real relief source on the Earth page (ETOPO 2022 ice surface, lakes at 0 m)', () => {
        const page = readFileSync(new URL('../earth-eonet-relief.html', import.meta.url), 'utf8');
        expect(page).toContain('NOAA ETOPO 2022 (60″ ice surface, area-averaged 1/6°, linear metres, vertical exaggeration ×10) relief; water mask NASA MODIS MOD44W via GIBS; lake surfaces rendered at 0 m (ETOPO has no lake levels).');
        expect(page).not.toMatch(/ETOPO-?1\b|bedrock-relief|bedrock-normal/);
    });

    it('night lights are attenuated by the same view transmittance', () => {
        const material = makeNightLightsMat({ THREE, texture });
        expect(material.uniforms.uAerialPerspective.value).toBe(1);
        expect(material.uniforms.uAtmosphereHaze.value).toBe(ATMOSPHERE.haze);
        expect(material.fragmentShader).toContain('light *= atmoViewTransmittance(vWorldPos, cameraPosition, uAtmosphereHaze)');
    });

    it('the atmosphere shell uses the shared library once, with shared defaults', () => {
        const material = makeAtmosphereMat(THREE);
        expect(material.fragmentShader.split('const float R_E').length - 1).toBe(1);
        expect(material.fragmentShader.split('float phaseR(').length - 1).toBe(1);
        expect(material.fragmentShader).toContain('exp(-atmoExtinction(tau, uPhysicalHaze))');
        expect(material.uniforms.uPhysicalIntensity.value).toBe(ATMOSPHERE.sunIntensity);
        expect(material.uniforms.uPhysicalHaze.value).toBe(ATMOSPHERE.haze);
    });
});
