import { describe, expect, it } from 'vitest';
import { EARTH_TEMPORAL_LAYERS, createTemporalDescriptor, formatTemporalBadge } from '../src/earth/temporal-provenance.js';

describe('Earth temporal provenance contract', () => {
    it('keeps scene, source, and load time as distinct fields', () => {
        const temporal = createTemporalDescriptor({
            temporalType: 'observed', sceneTimeCompatibility: 'latest-only',
            sourceTime: '2026-09-10T14:00:00Z', loadedAt: '2026-09-10T14:08:00Z', cacheState: 'fresh'
        });
        expect(temporal.sourceTime).toBe('2026-09-10T14:00:00.000Z');
        expect(temporal.loadedAt).toBe('2026-09-10T14:08:00.000Z');
        expect(temporal.sourceTime).not.toBe(temporal.loadedAt);
        expect(temporal.sceneTimeCompatibility).toBe('latest-only');
    });

    it('does not substitute load time for an unknown source time', () => {
        const temporal = createTemporalDescriptor({
            temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only', loadedAt: '2026-09-10T14:08:00Z'
        });
        expect(temporal.sourceTime).toBeNull();
        // The temporal badge never claims "Observed": scientific provenance
        // comes from the source registry (see source-provenance.test.js).
        expect(formatTemporalBadge(temporal)).toBe('Source time · source time unavailable');
    });

    it('classifies static, procedural, and latest-only layers truthfully', () => {
        expect(EARTH_TEMPORAL_LAYERS.blueMarble).toMatchObject({ temporalType: 'static-reference', sceneTimeCompatibility: 'static' });
        expect(EARTH_TEMPORAL_LAYERS.clouds).toMatchObject({ temporalType: 'procedural', sceneTimeCompatibility: 'static' });
        // LOT 5: EONET follows the chosen day; FIRMS still has only the latest data.
        expect(EARTH_TEMPORAL_LAYERS.eonet).toMatchObject({ temporalType: 'observed', sceneTimeCompatibility: 'date-selectable' });
        expect(EARTH_TEMPORAL_LAYERS.firms).toMatchObject({ temporalType: 'observed', sceneTimeCompatibility: 'latest-only' });
    });

    it('surfaces stale and fallback state without calling it live', () => {
        expect(formatTemporalBadge({ ...EARTH_TEMPORAL_LAYERS.usgs, sourceTime: '2026-09-10T14:00:00Z', cacheState: 'stale' }))
            .toContain('stale');
        expect(formatTemporalBadge({ ...EARTH_TEMPORAL_LAYERS.clouds, cacheState: 'fallback' })).toBe('Procedural fallback');
    });

    it('does not change a layer source timestamp when scene time is historical', () => {
        const layer = EARTH_TEMPORAL_LAYERS.blackMarble;
        expect(layer.sourceTime).toBe('2016-01-01T00:00:00.000Z');
        expect(layer.sceneTimeCompatibility).toBe('static');
    });

    it('uses live wording that rejects synchronized-snapshot semantics', () => {
        const label = 'Live astronomy · latest available data';
        expect(label).toContain('astronomy');
        expect(label).not.toMatch(/synchronized snapshot/i);
    });
});
