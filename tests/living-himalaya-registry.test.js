import { describe, expect, it } from 'vitest';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { validateObservatoryRegistry } from '../src/core/observatory/module-contract.js';
import { platformRegistry } from '../src/core/platform-registry.js';

describe('Living Himalaya is in development (Himalaya LOT 1), not a hero portal', () => {
    const himalaya = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya');

    it('is a development regional planetary record with a route and no portal', () => {
        expect(himalaya).toMatchObject({
            title: 'Living Himalaya',
            subtitle: 'Observatory',
            family: 'planetary',
            scale: 'regional',
            scaleAxis: 'physical',
            status: 'development',
            route: './living-himalaya.html',
            featured: false,
        });
        expect(himalaya.gateway).toBeUndefined();
        expect(himalaya.description).toMatch(/^A regional observatory in development/);
        expect(himalaya.representations).toEqual(['observed', 'reconstructed', 'prediction', 'fallback']);
        // Only what exists is declared: the peak reference list.
        expect(himalaya.sources).toEqual(['himalayaPeaks', 'himalayaTerrainGlo30', 'terrariumTiles', 'astronomy', 'openMeteoPressureLevels', 'sentinel2L2a']);
        expect(himalaya.roadmap.stage).not.toMatch(/Frozen/);
        expect(himalaya.roadmap.progress).toBeGreaterThan(0);
    });

    it('a development route raises no future-route warning; planned/research still do', () => {
        expect(platformRegistry.moduleContract.warnings.filter((entry) => entry.code === 'future-route')).toEqual([]);
        const base = { family: 'planetary', scale: 'planetary', scaleAxis: 'physical', representations: ['observed'], sources: [], roadmap: {} };
        const report = validateObservatoryRegistry([
            { ...base, id: 'd', title: 'Dev', status: 'development', route: './d.html' },
            { ...base, id: 'p', title: 'Planned', status: 'planned', route: './p.html' },
            { ...base, id: 'r', title: 'Research', status: 'research', route: './r.html' },
        ], { taxonomy: PLATFORM_TAXONOMY });
        expect(report.warnings.filter((entry) => entry.code === 'future-route').map((entry) => entry.moduleId)).toEqual(['p', 'r']);
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
        expect(routed).toEqual(['living-earth', 'living-protein', 'living-himalaya']);
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
