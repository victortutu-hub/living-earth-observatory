import { describe, expect, it } from 'vitest';
import {
    SURFACE_VISUAL_CASES,
    SURFACE_VISUAL_VIEWPORT,
    surfaceVisualCaseFromSearch,
    surfaceVisualMaterialDebugFromSearch,
    surfaceVisualMaterialFromSearch
} from '../src/earth/surface-visual-lock.js';

describe('surface visual lock query contract', () => {
    it('recognizes only the narrow, named 2.4B visual cases', () => {
        expect(surfaceVisualCaseFromSearch('?surfaceVisualCase=regional')).toBe('regional');
        expect(Object.keys(SURFACE_VISUAL_CASES)).toEqual([
            'global', 'continental', 'regional', 'close', 'terminator', 'night', 'polar', 'antimeridian'
        ]);
        expect(surfaceVisualCaseFromSearch('?surfaceVisualCase=unknown')).toBeNull();
        expect(surfaceVisualCaseFromSearch('')).toBeNull();
    });

    it('uses fixed non-moving scene values for every supported case', () => {
        for (const preset of Object.values(SURFACE_VISUAL_CASES)) {
            expect(preset.cameraPosition).toHaveLength(3);
            expect(preset.target).toEqual([0, 0, 0]);
            expect(preset.earthRotation).toHaveLength(3);
            expect(preset.earthRotation.every(Number.isFinite)).toBe(true);
            expect(new Date(preset.iso).toISOString()).toBe(preset.iso);
        }
    });

    it('keeps Phong as the primary path unless PBR is explicitly requested', () => {
        expect(surfaceVisualMaterialFromSearch('?surfaceVisualCase=regional')).toBe('phong');
        expect(surfaceVisualMaterialFromSearch('?surfaceVisualMaterial=pbr')).toBe('pbr');
    });

    it('uses one fixed render buffer so comparisons do not depend on browser viewport or DPR', () => {
        expect(SURFACE_VISUAL_VIEWPORT).toEqual({ width: 1440, height: 900, dpr: 1 });
    });

    it('keeps same-session material controls opt-in only', () => {
        expect(surfaceVisualMaterialDebugFromSearch('')).toBe(false);
        expect(surfaceVisualMaterialDebugFromSearch('?surfaceVisualCase=regional&surfaceMaterialDebug=1')).toBe(true);
    });
});
