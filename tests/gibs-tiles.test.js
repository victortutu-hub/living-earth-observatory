import { describe, expect, it } from 'vitest';
import {
    GIBS_LAYERS,
    GibsTileQueue,
    LruTileCache,
    gibsTileKey,
    gibsTileUrl,
    gibsWmsTileUrl,
    tileGridDimensions,
    tileLatLonBounds,
} from '../src/earth/gibs-tiles.js';
import { blueMarbleWmsUrl } from '../src/earth/gibs-surface.js';

describe('EPSG:4326 GIBS tile math', () => {
    it('computes grid dimensions (2:1 aspect, doubling per zoom level)', () => {
        expect(tileGridDimensions(0)).toEqual({ columns: 2, rows: 1 });
        expect(tileGridDimensions(2)).toEqual({ columns: 8, rows: 4 });
    });

    // Prioritate #1 din roadmap: ordinea {z}/{y}/{x} si limitele lat/lon la z=0
    // sunt exact clasa de bug care a produs tile-uri gresite in v2.4.2.
    it('computes tile bounds at z=0 without swapping lat/lon', () => {
        expect(tileLatLonBounds(0, 0, 0)).toEqual({ west: -180, east: 0, north: 90, south: -90 });
        expect(tileLatLonBounds(0, 1, 0)).toEqual({ west: 0, east: 180, north: 90, south: -90 });
    });
});

describe('GIBS URL builders', () => {
    it('builds a WMTS URL with {z}/{y}/{x} order (row before column)', () => {
        const url = gibsTileUrl(GIBS_LAYERS.dailyClouds, '2026-07-25', 1, 3, 1);
        expect(url).toMatch(/VIIRS_SNPP_CorrectedReflectance_TrueColor\/default\/2026-07-25\/250m\/1\/1\/3\.jpg$/);
    });

    it('builds a WMS fallback URL with the correct CRS, TIME and BBOX', () => {
        const wms = new URL(gibsWmsTileUrl(GIBS_LAYERS.dailyClouds, '2026-07-25', 1, 3, 1));
        expect(wms.searchParams.get('CRS')).toBe('EPSG:4326');
        expect(wms.searchParams.get('TIME')).toBe('2026-07-25');
        expect(wms.searchParams.get('BBOX')).toBe('-90,90,0,180');
    });

    it('builds a stable, non-temporal cache key for non-temporal layers', () => {
        expect(gibsTileKey(GIBS_LAYERS.blueMarble, 'ignored', 1, 0, 0))
            .toBe('BlueMarble_ShadedRelief_Bathymetry:default:1:0:0');
    });

    it('requests the full global equirectangular Blue Marble raster', () => {
        const url = new URL(blueMarbleWmsUrl(8192, 4096));
        expect(url.searchParams.get('LAYERS')).toBe('BlueMarble_ShadedRelief_Bathymetry');
        expect(url.searchParams.get('BBOX')).toBe('-90,-180,90,180');
        expect(url.searchParams.get('WIDTH')).toBe('8192');
        expect(url.searchParams.get('HEIGHT')).toBe('4096');
        expect(url.searchParams.get('CRS')).toBe('EPSG:4326');
    });
});

describe('LruTileCache', () => {
    it('disposes evicted resources exactly once', () => {
        const disposed = [];
        const cache = new LruTileCache(2);
        cache.set('a', { dispose: () => disposed.push('a') });
        cache.set('b', { dispose: () => disposed.push('b') });
        cache.get('a'); // touch 'a' so 'b' is the least recently used
        cache.set('c', { dispose: () => disposed.push('c') });
        expect(disposed).toEqual(['b']);
        cache.clear();
        expect(disposed.sort()).toEqual(['a', 'b', 'c']);
    });
});

describe('GibsTileQueue', () => {
    it('bounds concurrent work and drains pending requests in priority order', async () => {
        const started = [];
        const release = [];
        const queue = new GibsTileQueue({
            concurrency: 1,
            load: (url) => new Promise(resolve => {
                started.push(url);
                release.push(() => resolve(url));
            }),
        });
        const low = queue.request('low', 'low', 1);
        const high = queue.request('high', 'high', 9);
        expect(started).toEqual(['low']);
        release.shift()();
        await low;
        // Completed tasks are removed in Promise.finally(), which runs after the
        // caller's await continuation, so yield once before asserting the next start.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(started).toEqual(['low', 'high']);
        release.shift()();
        await expect(high).resolves.toBe('high');
    });
});
