import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { gvpVolcanoesPlugin } from '../src/earth/layers/gvp-volcanoes.js';

const gvpFixture = JSON.parse(
    await readFile(new URL('./fixtures/gvp-volcanoes.geojson', import.meta.url), 'utf8')
);

describe('gvpVolcanoesPlugin.normalize (fixture -> normalize, layer-plugin contract)', () => {
    it('normalizes lon/lat and carries provenance through to the detail payload', () => {
        const items = gvpVolcanoesPlugin.normalize(gvpFixture);
        expect(items).toHaveLength(2);
        expect({ lon: items[0].lon, lat: items[0].lat }).toEqual({ lon: 14.999, lat: 37.748 });
        expect(items[0].title).toBe('Etna');
        expect(items[0].detail.at(-1).value).toMatch(/volcano\.si\.edu/);
        expect({ lon: items[1].lon, lat: items[1].lat }).toEqual({ lon: 167.166, lat: -77.53 });
    });
});
