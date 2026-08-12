import { describe, expect, it } from 'vitest';
import { createGeoUtils } from '../src/earth/geo.js';

// Minimal THREE stand-in: geo.js only needs degToRad and a settable Vector3.
const THREE = {
    MathUtils: { degToRad: degrees => degrees * Math.PI / 180 },
    Vector3: class Vector3 {
        set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    }
};

const { lonLatToVec3, vec3ToLonLat } = createGeoUtils(THREE);

describe('lon/lat <-> Vector3 round trip', () => {
    // Regression guard for the class of bug from v2.4.2: [lat,lon] vs [lon,lat]
    // swapped silently and only showed up as markers on the wrong continent.
    const samples = [
        { lon: 25, lat: 45 },
        { lon: 0, lat: 90 },
        { lon: 0, lat: -90 },
        { lon: 179.999, lat: 12.5 },
        { lon: -180, lat: -12.5 },
    ];

    it.each(samples)('round-trips lon=$lon lat=$lat', ({ lon, lat }) => {
        const roundTrip = vec3ToLonLat(lonLatToVec3(lon, lat, 2));
        expect(Math.abs(roundTrip.lat - lat)).toBeLessThan(1e-9);
        const longitudeDelta = Math.abs(((roundTrip.lon - lon + 540) % 360) - 180);
        expect(longitudeDelta).toBeLessThan(1e-9);
    });

    it('rejects a zero vector instead of returning a bogus lon/lat', () => {
        expect(() => vec3ToLonLat({ x: 0, y: 0, z: 0 })).toThrow(/non-zero/);
    });
});
