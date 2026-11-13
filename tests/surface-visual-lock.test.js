import { describe, expect, it } from 'vitest';
import {
    SURFACE_VISUAL_ALBEDO_SIZE,
    SURFACE_VISUAL_CAPTURE_CLASS,
    SURFACE_VISUAL_CASES,
    SURFACE_VISUAL_VIEWPORT,
    surfaceVisualCaseFromSearch,
    surfaceVisualMaterialDebugFromSearch,
    surfaceVisualMaterialFromSearch,
    surfaceVisualOverridesFromSearch
} from '../src/earth/surface-visual-lock.js';

const ORBIT_MIN_DISTANCE = 3.1; // src/earth/scene-runtime.js controls.minDistance
const EARTH_RADIUS = 2.0;

describe('surface visual lock query contract', () => {
    it('recognizes only the narrow, named visual cases', () => {
        expect(surfaceVisualCaseFromSearch('?surfaceVisualCase=regional')).toBe('regional');
        expect(surfaceVisualCaseFromSearch('?surfaceVisualCase=limb')).toBe('limb');
        expect(Object.keys(SURFACE_VISUAL_CASES)).toEqual([
            'global', 'continental', 'regional', 'close', 'terminator', 'night', 'polar', 'antimeridian', 'asia', 'americas', 'limb'
        ]);
        expect(surfaceVisualCaseFromSearch('?surfaceVisualCase=unknown')).toBeNull();
        expect(surfaceVisualCaseFromSearch('')).toBeNull();
    });

    it('uses fixed non-moving scene values for every supported case', () => {
        for (const [name, preset] of Object.entries(SURFACE_VISUAL_CASES)) {
            expect(preset.cameraPosition).toHaveLength(3);
            // Only the limb case aims off-centre; every other case looks at the origin.
            if (name !== 'limb') expect(preset.target).toEqual([0, 0, 0]);
            expect(preset.earthRotation).toHaveLength(3);
            expect(preset.earthRotation.every(Number.isFinite)).toBe(true);
            expect(new Date(preset.iso).toISOString()).toBe(preset.iso);
        }
    });

    it('aims the limb case along a line that grazes the Earth, outside the orbit minimum distance', () => {
        const { cameraPosition: c, target: t } = SURFACE_VISUAL_CASES.limb;
        expect(t).not.toEqual([0, 0, 0]);
        const d = t.map((v, i) => v - c[i]);
        const length = Math.hypot(...d);
        expect(length).toBeGreaterThanOrEqual(ORBIT_MIN_DISTANCE); // controls.update() must not move the camera
        // Closest approach of the sight line to the Earth centre ~ the radius: the limb is mid-frame.
        const s = -c.reduce((sum, v, i) => sum + v * d[i], 0) / (length * length);
        const closest = Math.hypot(...c.map((v, i) => v + d[i] * s));
        expect(closest).toBeGreaterThan(EARTH_RADIUS - 0.02);
        expect(closest).toBeLessThan(EARTH_RADIUS + 0.075); // inside the atmosphere shell radius
    });

    it('pins the albedo size and names the capture-mode class', () => {
        expect(SURFACE_VISUAL_ALBEDO_SIZE).toEqual({ width: 4096, height: 2048 });
        expect(SURFACE_VISUAL_CAPTURE_CLASS).toBe('surface-visual-capture');
    });

    it('keeps Phong as the primary path unless PBR is explicitly requested', () => {
        expect(surfaceVisualMaterialFromSearch('?surfaceVisualCase=regional')).toBe('phong');
        expect(surfaceVisualMaterialFromSearch('?surfaceVisualMaterial=pbr')).toBe('pbr');
    });

    it('uses one fixed render buffer so comparisons do not depend on browser viewport or DPR', () => {
        expect(SURFACE_VISUAL_VIEWPORT).toEqual({ width: 1440, height: 900, dpr: 1 });
    });

    it('reads A/B material overrides only inside a lock case, and only valid values', () => {
        expect(surfaceVisualOverridesFromSearch('?reliefExaggeration=10&bathymetryMix=0')).toEqual({});
        expect(surfaceVisualOverridesFromSearch('?surfaceVisualCase=close')).toEqual({});
        expect(surfaceVisualOverridesFromSearch('?surfaceVisualCase=close&reliefExaggeration=0&reliefStrength=0.936'))
            .toEqual({ reliefExaggeration: 0, reliefStrength: 0.936 });
        expect(surfaceVisualOverridesFromSearch('?surfaceVisualCase=close&reliefExaggeration=-1&reliefStrength=abc'))
            .toEqual({});
        // The legacy relief A/B options are gone (LOT 4b-B).
        expect(surfaceVisualOverridesFromSearch('?surfaceVisualCase=close&reliefModel=legacy&coastNormals=clip&surfaceDebug=tilt&bathymetryMix=0.07'))
            .toEqual({});
    });

    it('keeps same-session material controls opt-in only', () => {
        expect(surfaceVisualMaterialDebugFromSearch('')).toBe(false);
        expect(surfaceVisualMaterialDebugFromSearch('?surfaceVisualCase=regional&surfaceMaterialDebug=1')).toBe(true);
    });
});
