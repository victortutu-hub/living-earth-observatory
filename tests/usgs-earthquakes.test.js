import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { featureToEvent } from '../src/earth/usgs-earthquakes.js';

const usgsFixture = JSON.parse(
    await readFile(new URL('./fixtures/usgs-sample.geojson', import.meta.url), 'utf8')
);

describe('featureToEvent (fixture -> normalize, USGS smoke test)', () => {
    it('normalizes a real-shaped feature into the internal event schema, coordinates in [lon,lat]', () => {
        const event = featureToEvent(usgsFixture.features[0], { minMagnitude: 2.5 });
        expect(event).toBeTruthy();
        expect(event.geometry[0].coordinates).toEqual([-122.5, 37.7]);
        expect(event.geometry[0].magnitudeValue).toBe(5.6);
        expect(event.title).toBe('M 5.6 earthquake - 10km SW of Sample City');
        expect(event.categories).toEqual([{ id: 'earthquakes', title: 'Earthquakes' }]);
    });

    it('strips the redundant "earthquake -" prefix some USGS place strings carry', () => {
        const event = featureToEvent(usgsFixture.features[1], { minMagnitude: 1 });
        expect(event.title).toBe('M 1.8 earthquake - 5km N of Sample Town');
    });

    it('filters out events below the configured minimum magnitude', () => {
        expect(featureToEvent(usgsFixture.features[1], { minMagnitude: 2.5 })).toBeNull();
    });

    it('rejects a feature with a missing/non-finite magnitude instead of fabricating one', () => {
        expect(featureToEvent(usgsFixture.features[2], { minMagnitude: 0 })).toBeNull();
    });
});
