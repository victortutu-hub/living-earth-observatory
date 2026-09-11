import { describe, expect, it } from 'vitest';
import {
    SURFACE_MATERIAL_DEBUG_MODES,
    SURFACE_MATERIAL_REPRESENTATION,
    createSurfaceMaterialLodConfig,
    deterministicSphericalMaterialSignal,
    surfaceMaterialDiagnosticGainFromSearch,
    surfaceMaterialDebugModeFromSearch,
    surfaceMaterialLandWeight,
    surfaceMaterialLodWeights
} from '../src/earth/surface-material-lod.js';
import { syncActiveReliefTexture } from '../src/earth/earth-material.js';

describe('surface material LOD', () => {
    const config = createSurfaceMaterialLodConfig({ earthRadius: 2 });

    it('keeps global views unchanged and blends continental, regional and close ranges', () => {
        expect(config.mesoFullDistance).toBe(4.7);
        expect(config.mesoFadeOutDistance).toBe(6);
        expect(surfaceMaterialLodWeights(6.4, config)).toEqual({ meso: 0 });
        const continental = surfaceMaterialLodWeights(5.3, config);
        expect(continental.meso).toBeGreaterThan(0);
        const regional = surfaceMaterialLodWeights(4.0, config);
        expect(regional.meso).toBeGreaterThan(0.9);
        expect(surfaceMaterialLodWeights(3.1, config)).toEqual({ meso: 1 });
    });

    it('keeps all calculated weights bounded', () => {
        for (const distance of [0, 3.1, 3.4, 4, 4.7, 5.4, 6.4, 12, Infinity]) {
            const { meso } = surfaceMaterialLodWeights(distance, config);
            expect(meso).toBeGreaterThanOrEqual(0);
            expect(meso).toBeLessThanOrEqual(1);
        }
    });

    it('supports unambiguous non-UI debug attribution modes', () => {
        expect(surfaceMaterialDebugModeFromSearch('?surfaceMaterial=off')).toBe(SURFACE_MATERIAL_DEBUG_MODES.off);
        expect(surfaceMaterialDebugModeFromSearch('?surfaceMaterial=on')).toBe(SURFACE_MATERIAL_DEBUG_MODES.on);
        expect(surfaceMaterialLodWeights(3.1, createSurfaceMaterialLodConfig({ earthRadius: 2, mode: 'off' }))).toEqual({ meso: 0 });
        expect(surfaceMaterialLodWeights(3.1, createSurfaceMaterialLodConfig({ earthRadius: 2, mode: 'on' }))).toEqual({ meso: 1 });
    });

    it('keeps diagnostic gain opt-in, bounded, and separate from production constants', () => {
        expect(surfaceMaterialDiagnosticGainFromSearch('')).toBe(1);
        expect(surfaceMaterialDiagnosticGainFromSearch('?surfaceMaterialGain=4')).toBe(4);
        expect(surfaceMaterialDiagnosticGainFromSearch('?surfaceMaterialGain=99')).toBe(4);
        const diagnostic = createSurfaceMaterialLodConfig({ earthRadius: 2, diagnosticGain: 4 });
        expect(diagnostic.pbrRoughnessAmplitude).toBe(config.pbrRoughnessAmplitude * 4);
        expect(diagnostic.phongSpecularAmplitude).toBe(config.phongSpecularAmplitude * 4);
    });

    it('uses a smooth observed-derived coast gate and explicit interpretive metadata', () => {
        expect(surfaceMaterialLandWeight(0.40, 0.42, config)).toBe(0);
        expect(surfaceMaterialLandWeight(0.43, 0.42, config)).toBeGreaterThan(0);
        expect(surfaceMaterialLandWeight(0.43, 0.42, config)).toBeLessThan(1);
        expect(surfaceMaterialLandWeight(0.46, 0.42, config)).toBe(1);
        expect(SURFACE_MATERIAL_REPRESENTATION.interpretive.toLowerCase()).toContain('interpretive');
    });

    it('keeps the direction-only signal deterministic and bounded', () => {
        const direction = { x: 0.3, y: -0.4, z: 0.8 };
        const first = deterministicSphericalMaterialSignal(direction, config.mesoFrequency);
        expect(deterministicSphericalMaterialSignal(direction, config.mesoFrequency)).toBe(first);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThanOrEqual(1);
    });

    it('keeps shader relief consumers synchronized with the active KTX2 replacement', () => {
        const initialTexture = { id: 'initial' };
        const upgradedTexture = { id: 'ktx2' };
        const reliefTextureRef = { current: initialTexture };
        const material = {
            userData: { shader: { uniforms: { uReliefMapTw: { value: initialTexture } } } }
        };
        syncActiveReliefTexture([material], reliefTextureRef, upgradedTexture);
        expect(reliefTextureRef.current).toBe(upgradedTexture);
        expect(material.userData.shader.uniforms.uReliefMapTw.value).toBe(upgradedTexture);
    });

});
