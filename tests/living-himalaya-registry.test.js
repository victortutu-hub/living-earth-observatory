import { describe, expect, it } from 'vitest';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { validateObservatoryRegistry } from '../src/core/observatory/module-contract.js';
import { platformRegistry } from '../src/core/platform-registry.js';

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

describe('parent/child observatories (LOT 6)', () => {
    const base = { family: 'planetary', scale: 'planetary', scaleAxis: 'physical', representations: ['observed'], sources: [], roadmap: {} };
    const parentLive = { ...base, id: 'p', title: 'Parent One', status: 'live', route: './p.html', gateway: { enabled: true, order: 0 } };
    const validate = (modules) => validateObservatoryRegistry(modules, { taxonomy: PLATFORM_TAXONOMY });
    const codes = (report) => report.errors.map((entry) => `${entry.moduleId}:${entry.code}`);

    it('Living Himalaya is a child of Living Earth; Living Ocean stays a parent', () => {
        expect(OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya').parent).toBe('living-earth');
        expect(OBSERVATORY_REGISTRY.find((item) => item.id === 'living-ocean').parent).toBeUndefined();
        expect(OBSERVATORY_REGISTRY.find((item) => item.id === 'living-earth').parent).toBeUndefined();
    });

    it('the real registry is valid', () => {
        expect(platformRegistry.moduleContract.valid).toBe(true);
        expect(platformRegistry.moduleContract.errors).toEqual([]);
    });

    it('the hero (gateway) lists parents only', () => {
        const featured = platformRegistry.getGatewayFeatured(10);
        expect(featured.map((item) => item.id)).toEqual(['living-earth', 'living-protein']);
        expect(featured.every((item) => !item.parent)).toBe(true);
    });

    it('accepts a child that names an existing top-level parent', () => {
        expect(validate([parentLive, { ...base, id: 'c', title: 'Child', status: 'planned', parent: 'p' }]).valid).toBe(true);
    });

    it('rejects an unknown parent', () => {
        expect(codes(validate([parentLive, { ...base, id: 'c', title: 'Child', status: 'planned', parent: 'missing' }]))).toEqual(['c:unknown-parent']);
    });

    it('rejects a module that is its own parent', () => {
        expect(codes(validate([{ ...base, id: 'c', title: 'Child', status: 'planned', parent: 'c' }]))).toEqual(['c:self-parent']);
    });

    it('rejects a parent that is itself a child (one level only)', () => {
        const report = validate([
            parentLive,
            { ...base, id: 'c', title: 'Child', status: 'planned', parent: 'p' },
            { ...base, id: 'g', title: 'Grandchild', status: 'planned', parent: 'c' },
        ]);
        expect(codes(report)).toEqual(['g:nested-parent']);
    });

    it('rejects a child enabled in the gateway', () => {
        const report = validate([parentLive, { ...parentLive, id: 'c', title: 'Child', route: './c.html', gateway: { enabled: true, order: 1 }, parent: 'p' }]);
        expect(codes(report)).toEqual(['c:gateway-child']);
    });
});
