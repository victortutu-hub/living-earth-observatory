import { describe, expect, it } from 'vitest';
import { horizonFacingThreshold, markerHorizonWeight } from '../src/earth/marker-horizon.js';

const cameraDirection = { x: 0, y: 0, z: 1 };
const options = { earthRadius: 2, markerRadius: 2.13, cameraDistance: 6.65 };

describe('marker horizon visibility', () => {
    it('shows the front and hides the opposite hemisphere', () => {
        expect(markerHorizonWeight({ ...options, markerDirection: cameraDirection, cameraDirection })).toBeGreaterThan(0.99);
        expect(markerHorizonWeight({ ...options, markerDirection: { x: 0, y: 0, z: -1 }, cameraDirection })).toBe(0);
    });
    it('is smooth at the altitude-derived horizon', () => {
        const horizon = horizonFacingThreshold(options);
        const weight = markerHorizonWeight({ ...options, markerDirection: { x: Math.sqrt(1 - horizon * horizon), y: 0, z: horizon }, cameraDirection });
        expect(horizon).toBeLessThan(0);
        expect(weight).toBeGreaterThan(0.45);
        expect(weight).toBeLessThan(0.55);
    });
});
