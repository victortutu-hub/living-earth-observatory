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
    BATHYMETRY_MIX,
    EARTH_RELIEF_SCALE,
    RELIEF_ENCODING,
    RELIEF_STRENGTH,
    RELIEF_TERMINATOR_EDGES,
    createEarthMaterial,
    createEarthMaterialPBR,
    displacementScaleForExaggeration,
    reliefExaggerationLabel,
    reliefGrayForLandElevation,
    reliefPerturbationWeight,
    verticalExaggerationAt,
} from '../src/earth/earth-material.js';
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
    const common = { THREE, earthMap: texture, earthSpecular: texture, earthRelief: texture, earthReliefNormal: texture };

    it.each([
        ['Phong', () => createEarthMaterial(common), RELIEF_STRENGTH.phong],
        ['PBR', () => createEarthMaterialPBR({ ...common, earthRoughnessMap: texture }), RELIEF_STRENGTH.pbr],
    ])('%s: no bumpMap, unit normalScale, no fog, relief + aerial perspective uniforms', (_name, build, strength) => {
        const material = build();
        expect(material.bumpMap).toBeUndefined();
        expect(material.normalScale).toEqual(new Vector2(1, 1));
        expect(material.fog).toBe(false);
        // Legacy displacement scale, unchanged since LOT 4.
        expect(material.displacementScale).toBe(EARTH_RELIEF_SCALE);
        expect(material.displacementBias).toBeCloseTo(-0.42 * EARTH_RELIEF_SCALE, 12);

        const shader = fakeShader();
        material.onBeforeCompile(shader);
        expect(shader.uniforms.uReliefStrengthTw.value).toBe(strength);
        for (const name of AERIAL_PERSPECTIVE_UNIFORMS) expect(shader.uniforms[name]).toBeDefined();
        expect(shader.uniforms.uSunIrradianceTw.value).toEqual(new Vector3(0, 0, 0)); // synced from the sun light per frame
        expect(shader.uniforms.uAtmosphereHazeTw.value).toBe(ATMOSPHERE.haze);
        expect(shader.vertexShader).toContain('vWorldPosTw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        // Flat sea in geometry: displacement clamped at the relief sea level (0.42).
        expect(shader.vertexShader).toContain('max( texture2D( displacementMap, vDisplacementMapUv ).x, 0.4200 )');
        expect(shader.vertexShader).not.toContain('#include <displacementmap_vertex>');
        expect(shader.fragmentShader).toContain('reliefSunTw = smoothstep(-0.05, 0.05');
        expect(shader.fragmentShader).toContain('surfaceLandWeightTw * reliefSunTw');
        expect(shader.fragmentShader).toContain('atmoAerialInscatter(vWorldPosTw, cameraPosition');
        // The aerial perspective runs once, right before the opaque output.
        expect(shader.fragmentShader.split('atmoAerialInscatter(vWorldPosTw').length - 1).toBe(1);
        expect(shader.fragmentShader.indexOf('outgoingLight * apTransmittanceTw'))
            .toBeLessThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'));
        expect(shader.fragmentShader).not.toContain('oceanFlattenPBR');
        // Production: ocean = Blue Marble NG albedo only, no lock-only code compiled in.
        expect(BATHYMETRY_MIX).toBe(0);
        expect(shader.fragmentShader).not.toContain('bathyRampTw');
        expect(shader.fragmentShader).not.toContain('gradClipTw');
        expect(shader.fragmentShader).not.toContain('visual-lock debug view');
        // The land/water mask stays (one relief sample).
        expect(shader.fragmentShader).toContain('surfaceLandWeightTw = smoothstep(');
        expect(shader.fragmentShader.match(/texture2D\(uReliefMapTw/g)).toHaveLength(1);
        expect(material.customProgramCacheKey()).toContain('"coastNormals":false');
    });

    it.each([
        ['Phong', (overrides) => createEarthMaterial({ ...common, overrides })],
        ['PBR', (overrides) => createEarthMaterialPBR({ ...common, earthRoughnessMap: texture, overrides })],
    ])('%s: visual-lock overrides compile the lock-only code in', (_name, build) => {
        const shader = fakeShader();
        const material = build({ reliefStrength: 0.936, bathymetryMix: 0.07, coastNormals: 'clip', surfaceDebug: 'tiltClipped' });
        material.onBeforeCompile(shader);
        expect(shader.uniforms.uReliefStrengthTw.value).toBe(0.936);
        expect(shader.fragmentShader).toContain('mix(diffuseColor.rgb, bathyRampTw, 0.0700)');
        // Coast correction: 4 relief samples, gain of the ETOPO normal map (76 per texel).
        expect(shader.fragmentShader).toContain('slopeTw - 76.0 * (gradClipTw - gradRawTw)');
        expect(shader.fragmentShader).toContain('normal = normalize(tbn * coastNTw)');
        expect(shader.fragmentShader.match(/texture2D\(uReliefMapTw, vMapUv [+-] vec2/g)).toHaveLength(4);
        expect(shader.fragmentShader).toContain('outgoingLight = vec3(dbgTiltClipTw);');
        expect(material.customProgramCacheKey()).toContain('"surfaceDebug":2');
    });

    it('debug view without the coast correction keeps the production normal', () => {
        const shader = fakeShader();
        createEarthMaterial({ ...common, overrides: { surfaceDebug: 'landWeight' } }).onBeforeCompile(shader);
        expect(shader.fragmentShader).toContain('outgoingLight = vec3(surfaceLandWeightTw);');
        expect(shader.fragmentShader).not.toContain('coastNTw');
    });
});

describe('relief vertical exaggeration', () => {
    it('uses the reconstructed encoding anchors (highest 1/6 deg sample, not Everest)', () => {
        expect(reliefGrayForLandElevation(0)).toBe(0.42);
        expect(reliefGrayForLandElevation(RELIEF_ENCODING.landMaxM)).toBeCloseTo(0.9246, 4); // gray max of the PNG
        expect(reliefGrayForLandElevation(5029)).toBeCloseTo(0.8586, 3); // the texel at Everest
        expect(RELIEF_ENCODING).not.toHaveProperty('peakElevationM');
    });

    it('keeps the LOT 4 displacement and states its real, non-linear exaggeration', () => {
        expect(EARTH_RELIEF_SCALE).toBe(0.0633356100942748);
        expect(verticalExaggerationAt(EARTH_RELIEF_SCALE)).toBeCloseTo(15.1, 1);
        expect(verticalExaggerationAt(EARTH_RELIEF_SCALE, 5029)).toBeCloseTo(17.6, 1);
        expect(verticalExaggerationAt(EARTH_RELIEF_SCALE, 100)).toBeGreaterThan(100);
        expect(verticalExaggerationAt(EARTH_RELIEF_SCALE, 0)).toBeNaN();
    });

    it('inverts exactly at a given elevation', () => {
        expect(verticalExaggerationAt(displacementScaleForExaggeration(15), 6734)).toBeCloseTo(15, 10);
        expect(verticalExaggerationAt(displacementScaleForExaggeration(10, 1000), 1000)).toBeCloseTo(10, 10);
        expect(displacementScaleForExaggeration(0)).toBe(0);
    });

    it('labels the relief honestly (no single "x10" claim)', () => {
        const label = reliefExaggerationLabel(EARTH_RELIEF_SCALE);
        expect(label).toBe('Relief: non-linear vertical exaggeration (≈×15 at the highest 1/6° sample, 6,734 m; '
            + '≈×41 at 1,000 m; ≈×135 at 100 m; much stronger at low elevations — legacy sqrt-like encoding '
            + 'of ETOPO 2022 60″ bedrock, point-sampled 1/6°; ocean surface flat)');
        expect(label).not.toMatch(/×10\b|highest summit|Everest/);
        expect(reliefExaggerationLabel(0)).toBe('Relief: no geometric displacement (relief shading from ETOPO 2022 normals only)');
    });

    it('names the real relief source on the Earth page (ETOPO 2022, not ETOPO1)', () => {
        const page = readFileSync(new URL('../earth-eonet-relief.html', import.meta.url), 'utf8');
        expect(page).toContain('NOAA ETOPO 2022 (60″ bedrock, point-sampled 1/6°) relief');
        expect(page).not.toMatch(/ETOPO-?1\b/);
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
