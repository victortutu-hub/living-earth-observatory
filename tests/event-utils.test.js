import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { normalizeEventGeometry, normalizeLonLatCoordinates } from '../src/earth/event-utils.js';

const eonetFixture = JSON.parse(
    await readFile(new URL('./fixtures/eonet-sample.json', import.meta.url), 'utf8')
);

describe('normalizeLonLatCoordinates (EONET Point geometry)', () => {
    it('keeps well-formed [lon,lat] pairs unchanged', () => {
        expect(normalizeLonLatCoordinates([-120.5, 38.2])).toEqual([-120.5, 38.2]);
    });

    it('repairs a swapped [lat,lon] pair when only one order is geographically valid', () => {
        // second value (120.5) cannot be a latitude, but the first (38.2) is
        // a valid longitude too -- the disambiguation relies on the first
        // value being a valid latitude and the second not.
        expect(normalizeLonLatCoordinates([38.2, 120.5])).toEqual([120.5, 38.2]);
    });

    it('rejects coordinates where neither order is a valid lon/lat pair', () => {
        expect(normalizeLonLatCoordinates([200, 100])).toBeNull();
    });
});

describe('normalizeEventGeometry (fixture -> normalize, EONET shape)', () => {
    // This is the exact bug class from v2.4.2: EONET Polygon rings ship in
    // [lat,lon] order (reverse of GeoJSON / of EONET's own Point geometries),
    // and normalizeEventGeometry must swap them unconditionally.
    it('swaps Polygon ring coordinates from EONET [lat,lon] to [lon,lat]', () => {
        const [, stormEvent] = eonetFixture.events.map(normalizeEventGeometry);
        const ring = stormEvent.geometry[0].coordinates[0];
        // Fixture ring first vertex is [lat=38.2, lon=-120.5] as EONET publishes it.
        expect(ring[0]).toEqual([-120.5, 38.2]);
    });

    it('leaves Point geometry coordinates in [lon,lat] order', () => {
        const [wildfireEvent] = eonetFixture.events.map(normalizeEventGeometry);
        expect(wildfireEvent.geometry[0].coordinates).toEqual([-120.5, 38.2]);
    });
});
