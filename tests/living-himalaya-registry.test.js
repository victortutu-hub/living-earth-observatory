import { describe, expect, it } from 'vitest';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';

describe('Living Himalaya is planned, not launched', () => {
    const himalaya = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya');

    it('is a planned regional planetary record with no route and no portal', () => {
        expect(himalaya).toMatchObject({
            title: 'Living Himalaya',
            subtitle: 'Observatory',
            family: 'planetary',
            scale: 'regional',
            scaleAxis: 'physical',
            status: 'planned',
            route: null,
            featured: false,
        });
        expect(himalaya.gateway).toBeUndefined();
        expect(himalaya.description).toMatch(/^A planned regional observatory/);
        expect(himalaya.representations).toEqual(['observed', 'reconstructed', 'prediction', 'fallback']);
        // No integration is declared before it exists.
        expect(himalaya.sources).toEqual([]);
        expect(himalaya.roadmap).toMatchObject({ progress: 0, stage: 'Frozen until Gate 2' });
    });

    it('uses a regional scale placed between ecological and planetary', () => {
        const ids = PLATFORM_TAXONOMY.scales.map((scale) => scale.id);
        expect(ids.indexOf('regional')).toBe(ids.indexOf('ecological') + 1);
        expect(ids.indexOf('planetary')).toBe(ids.indexOf('regional') + 1);
        const regional = PLATFORM_TAXONOMY.scales.find((scale) => scale.id === 'regional');
        expect(regional).toMatchObject({ label: 'Regional', description: 'Regions and landscapes: mountain ranges, basins, coastlines.' });
        expect(regional.axis ?? 'physical').toBe('physical');
        // `order` stays consecutive and follows the array order.
        expect(PLATFORM_TAXONOMY.scales.map((scale) => scale.order)).toEqual(PLATFORM_TAXONOMY.scales.map((_, i) => i));
    });

    it('keeps the hero portals at Living Earth and Living Protein', () => {
        const portals = OBSERVATORY_REGISTRY.filter((item) => item.gateway).map((item) => item.id);
        expect(portals).toEqual(['living-earth', 'living-protein']);
        const routed = OBSERVATORY_REGISTRY.filter((item) => item.route).map((item) => item.id);
        expect(routed).toEqual(['living-earth', 'living-protein']);
    });
});
