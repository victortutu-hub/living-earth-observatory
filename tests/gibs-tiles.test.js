import { describe, expect, it, vi } from 'vitest';
import {
    GIBS_EPSG4326_TILE_MATRIX_SETS,
    GIBS_LAYERS,
    GibsTileQueue,
    LruTileCache,
    composeGibsEquirectangularMosaic,
    gibsGlobeCoverage,
    gibsTileKey,
    gibsTileUrl,
    loadTileWithRetry,
    tileGridDimensions,
    tileLatLonBounds,
} from '../src/earth/gibs-tiles.js';
import * as gibsTiles from '../src/earth/gibs-tiles.js';
import { SURFACE_LEVELS, loadBlueMarbleSurfaceTexture, surfaceStatus } from '../src/earth/gibs-surface.js';
import { loadBlackMarbleTexture } from '../src/earth/gibs-night-lights.js';
import { planGibsMosaic, summarizeTileResults } from '../src/gateway/assets/earth-texture-loader.js';
import { GATEWAY_DATA_SOURCES } from '../src/gateway/gateway-config.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';

// --- test doubles -----------------------------------------------------------
function fakeCanvasFactory() {
    const canvases = [];
    const create = (width, height) => {
        const draws = [];
        const canvas = {
            width,
            height,
            draws,
            getContext: () => ({ drawImage: (...args) => draws.push(args), imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }),
        };
        canvases.push(canvas);
        return canvas;
    };
    return { create, canvases };
}
const tileImage = (url) => ({ url, close: vi.fn() });
class Texture { constructor(source) { this.source = source; this.userData = {}; } dispose() { this.disposed = true; } }
const THREE = { CanvasTexture: Texture, SRGBColorSpace: 'srgb' };
const renderer = { capabilities: { getMaxAnisotropy: () => 16 } };

describe('GIBS EPSG:4326 tile grid (from GetCapabilities, 2026-11-12)', () => {
    it('declares the real matrix for every level instead of a 2^z formula', () => {
        expect(tileGridDimensions('500m', 0)).toEqual({ columns: 2, rows: 1, tileSpanDeg: 288 });
        expect(tileGridDimensions('500m', 1)).toEqual({ columns: 3, rows: 2, tileSpanDeg: 144 });
        expect(tileGridDimensions('500m', 2)).toEqual({ columns: 5, rows: 3, tileSpanDeg: 72 });
        expect(tileGridDimensions('500m', 3)).toEqual({ columns: 10, rows: 5, tileSpanDeg: 36 });
        expect(tileGridDimensions('250m', 8)).toEqual({ columns: 320, rows: 160, tileSpanDeg: 1.125 });
    });

    it('has the published number of levels per set (500m: 0-7, not 0-8)', () => {
        const levels = Object.fromEntries(Object.entries(GIBS_EPSG4326_TILE_MATRIX_SETS).map(([id, l]) => [id, l.length]));
        expect(levels).toEqual({ '16km': 3, '2km': 6, '1km': 7, '500m': 8, '250m': 9, '31.25m': 12, '15.625m': 13 });
        expect(() => tileGridDimensions('500m', 8)).toThrow(RangeError);
        expect(GIBS_LAYERS.blueMarble.maxZoom).toBe(7);
        expect(GIBS_LAYERS.nightLights.maxZoom).toBe(7);
        expect(GIBS_LAYERS.dailyClouds.maxZoom).toBe(8);
    });

    it('z0 is 2 x 1 tiles of 288 deg that overhang the globe', () => {
        expect(tileLatLonBounds('500m', 0, 0, 0)).toEqual({ west: -180, east: 108, north: 90, south: -198 });
        expect(tileLatLonBounds('500m', 0, 1, 0)).toEqual({ west: 108, east: 396, north: 90, south: -198 });
    });

    it('crops each level to 360 x 180 and requests only tiles that touch the globe', () => {
        expect(gibsGlobeCoverage('500m', 0)).toMatchObject({ columns: 2, rows: 1, width: 640, height: 320 });
        expect(gibsGlobeCoverage('500m', 1)).toMatchObject({ columns: 3, rows: 2, width: 1280, height: 640 });
        expect(gibsGlobeCoverage('500m', 2)).toMatchObject({ columns: 5, rows: 3, width: 2560, height: 1280 });
        expect(gibsGlobeCoverage('500m', 3)).toMatchObject({ columns: 10, rows: 5, width: 5120, height: 2560 });
    });
});

describe('GIBS URL builders', () => {
    it('builds a WMTS URL with {z}/{row}/{col} order and the layer matrix set', () => {
        const url = gibsTileUrl(GIBS_LAYERS.dailyClouds, '2026-07-25', 1, 2, 1);
        expect(url).toMatch(/VIIRS_SNPP_CorrectedReflectance_TrueColor\/default\/2026-07-25\/250m\/1\/1\/2\.jpg$/);
        expect(() => gibsTileUrl(GIBS_LAYERS.dailyClouds, '2026-07-25', 1, 3, 1)).toThrow(RangeError);
    });

    it('uses Blue Marble Next Generation (no baked relief) and Black Marble with a date', () => {
        expect(gibsTileUrl(GIBS_LAYERS.blueMarble, null, 2, 4, 2))
            .toBe('https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/default/500m/2/2/4.jpeg');
        expect(gibsTileUrl(GIBS_LAYERS.nightLights, '2016-01-01', 2, 0, 0))
            .toBe('https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_Black_Marble/default/2016-01-01/500m/2/0/0.png');
    });

    it('has no per-tile WMS fallback any more', () => {
        expect(gibsTiles.gibsWmsTileUrl).toBeUndefined();
    });

    it('builds a stable, non-temporal cache key for non-temporal layers', () => {
        expect(gibsTileKey(GIBS_LAYERS.blueMarble, 'ignored', 1, 0, 0)).toBe('BlueMarble_NextGeneration:default:1:0:0');
    });
});

describe('GIBS mosaic composition', () => {
    it('places z2 tiles on a 2560 x 1280 crop (padding row/column clipped)', async () => {
        const canvas = fakeCanvasFactory();
        const loadImage = vi.fn(async (url) => tileImage(url));
        const mosaic = await composeGibsEquirectangularMosaic({ layer: GIBS_LAYERS.blueMarble, z: 2, loadImage, createCanvas: canvas.create });
        expect(mosaic).toMatchObject({ z: 2, tiles: 15, width: 2560, height: 1280, sourceWidth: 2560, sourceHeight: 1280 });
        expect(canvas.canvases).toHaveLength(1);
        const draws = canvas.canvases[0].draws;
        expect(draws).toHaveLength(15);
        const last = draws.find(([image]) => image.url.endsWith('/2/2/4.jpeg'));
        expect(last.slice(1)).toEqual([2048, 1024, 512, 512]); // overhangs past 2560 x 1280 -> clipped
        expect(loadImage.mock.calls.every(([url]) => url.includes('/500m/2/'))).toBe(true);
    });

    it('resamples z3 (5120 x 2560) to the requested 4096 x 2048 and releases the crop', async () => {
        const canvas = fakeCanvasFactory();
        const mosaic = await composeGibsEquirectangularMosaic({
            layer: GIBS_LAYERS.blueMarble, z: 3, loadImage: async (url) => tileImage(url),
            createCanvas: canvas.create, outputSize: { width: 4096, height: 2048 },
        });
        expect(mosaic).toMatchObject({ tiles: 50, sourceWidth: 5120, sourceHeight: 2560, width: 4096, height: 2048 });
        const [crop, output] = canvas.canvases;
        expect(crop.draws).toHaveLength(50);
        expect(output.draws).toEqual([[crop, 0, 0, 4096, 2048]]);
        expect(crop.width).toBe(0);
    });

    it('bounds concurrency to the requested limit', async () => {
        let active = 0;
        let peak = 0;
        const loadImage = async (url) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 1));
            active--;
            return tileImage(url);
        };
        await composeGibsEquirectangularMosaic({ layer: GIBS_LAYERS.blueMarble, z: 3, loadImage, concurrency: 8, createCanvas: fakeCanvasFactory().create });
        expect(peak).toBe(8);
    });

    it('rejects the whole mosaic if a tile still fails after its retry (no partial globe)', async () => {
        const loadImage = vi.fn(async (url) => {
            if (url.endsWith('/2/1/3.jpeg')) throw new Error('HTTP 500');
            return tileImage(url);
        });
        await expect(composeGibsEquirectangularMosaic({ layer: GIBS_LAYERS.blueMarble, z: 2, loadImage, createCanvas: fakeCanvasFactory().create }))
            .rejects.toThrow('HTTP 500');
        expect(loadImage.mock.calls.filter(([url]) => url.endsWith('/2/1/3.jpeg'))).toHaveLength(2); // 1 try + 1 retry
    });
});

describe('per-tile timeout and retry', () => {
    it('times out a hanging tile, retries once, then rejects', async () => {
        const loadImage = vi.fn(() => new Promise(() => {}));
        await expect(loadTileWithRetry(loadImage, 'u', { timeoutMs: 15, retries: 1 })).rejects.toThrow(/timed out after 15 ms/);
        expect(loadImage).toHaveBeenCalledTimes(2);
    });

    it('succeeds on the retry after a first failure', async () => {
        const loadImage = vi.fn().mockRejectedValueOnce(new Error('reset')).mockResolvedValueOnce('ok');
        await expect(loadTileWithRetry(loadImage, 'u', { timeoutMs: 1000, retries: 1 })).resolves.toBe('ok');
        expect(loadImage).toHaveBeenCalledTimes(2);
    });

    it('never retries an abort', async () => {
        const controller = new AbortController();
        controller.abort();
        const loadImage = vi.fn();
        await expect(loadTileWithRetry(loadImage, 'u', { signal: controller.signal })).rejects.toThrow();
        expect(loadImage).not.toHaveBeenCalled();
    });
});

describe('Blue Marble surface (progressive WMTS z2 -> z3)', () => {
    it('applies z2 then z3 (4096 x 2048) and reports each level', async () => {
        const levels = [];
        const result = await loadBlueMarbleSurfaceTexture({
            THREE, renderer, loadImage: async (url) => tileImage(url), createCanvas: fakeCanvasFactory().create,
            onLevel: (texture, info) => levels.push([info.z, info.resolution, info.final, texture.userData.surfaceResolution]),
        });
        expect(SURFACE_LEVELS).toEqual([2, 3]);
        expect(levels).toEqual([[2, '2560x1280', false, '2560x1280'], [3, '4096x2048', true, '4096x2048']]);
        expect(result).toMatchObject({ z: 3, resolution: '4096x2048', failures: [] });
        expect(result.texture.colorSpace).toBe('srgb');
        expect(result.texture.anisotropy).toBe(8);
    });

    it('keeps z2 when z3 fails and says so', async () => {
        const loadImage = async (url) => { if (url.includes('/500m/3/')) throw new Error('down'); return tileImage(url); };
        const result = await loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: fakeCanvasFactory().create, policy: { concurrency: 8, tileTimeoutMs: 50, retries: 0 } });
        expect(result.z).toBe(2);
        expect(result.failures).toEqual(['z3: down']);
    });

    it('rejects when every level fails, so the bundled fallback stays', async () => {
        const loadImage = async () => { throw new Error('offline'); };
        await expect(loadBlueMarbleSurfaceTexture({ THREE, renderer, loadImage, createCanvas: fakeCanvasFactory().create, policy: { concurrency: 8, tileTimeoutMs: 50, retries: 0 } }))
            .rejects.toThrow('NASA GIBS Blue Marble WMTS unavailable — z2: offline; z3: offline');
    });

    it('states the active level and the fallback in #surfaceStatus', () => {
        expect(surfaceStatus({ kind: 'preview', z: 2, resolution: '2560x1280' }))
            .toEqual({ state: 'nasa', message: 'Surface: NASA GIBS / Blue Marble NG — WMTS z2 preview active (2560x1280); refining' });
        expect(surfaceStatus({ kind: 'settled', z: 3, resolution: '4096x2048', finalLevel: 3 }).message)
            .toBe('Surface: NASA GIBS / Blue Marble static reference active (WMTS z3 → 4096x2048)');
        expect(surfaceStatus({ kind: 'settled', z: 2, resolution: '2560x1280', finalLevel: 3 }).message)
            .toBe('Surface: NASA GIBS / Blue Marble static reference active (WMTS z2, 2560x1280; z3 unavailable)');
        expect(surfaceStatus({ kind: 'unavailable' }))
            .toEqual({ state: 'fallback', message: 'Surface: bundled fallback texture active — NASA GIBS WMTS unavailable' });
        expect(surfaceStatus({ kind: 'still-loading' }).state).toBe('fallback');
        // The preview is not "settled": capture harnesses wait for "static reference active".
        expect(surfaceStatus({ kind: 'preview', z: 2, resolution: 'x' }).message).not.toMatch(/static reference active/);
    });
});

describe('Black Marble (WMTS z2)', () => {
    it('composes VIIRS_Black_Marble z2 for the requested year', async () => {
        const loadImage = vi.fn(async (url) => tileImage(url));
        const texture = await loadBlackMarbleTexture({ THREE, renderer, loadImage, createCanvas: fakeCanvasFactory().create });
        expect(loadImage).toHaveBeenCalledTimes(15);
        expect(loadImage.mock.calls[0][0]).toContain('/VIIRS_Black_Marble/default/2016-01-01/500m/2/');
        expect(texture.userData).toMatchObject({ gibsLevel: 2, gibsTiles: 15, resolution: '2560x1280' });
        expect(texture.userData.temporal.sourceTime).toBe('2016-01-01T00:00:00.000Z');
    });

    it('rejects on total failure (the local night-lights fallback stays)', async () => {
        const loadImage = async () => { throw new Error('offline'); };
        await expect(loadBlackMarbleTexture({ THREE, renderer, loadImage, createCanvas: fakeCanvasFactory().create, policy: { concurrency: 8, tileTimeoutMs: 50, retries: 0 } }))
            .rejects.toThrow('offline');
    });
});

describe('Atlas preview (gateway) on WMTS', () => {
    it('declares a z2 Blue Marble NG mosaic, not the WMS shaded relief', () => {
        expect(GATEWAY_DATA_SOURCES.earthTexture).toEqual({ kind: 'gibs-wmts-mosaic', layer: 'blueMarble', z: 2, width: 2048, height: 1024 });
        const plan = planGibsMosaic(GATEWAY_DATA_SOURCES.earthTexture);
        expect(plan.tiles).toHaveLength(15);
        expect(plan.coverage).toMatchObject({ width: 2560, height: 1280 });
        expect(plan.tiles.every((tile) => tile.url.includes('/wmts/epsg4326/best/BlueMarble_NextGeneration/'))).toBe(true);
    });

    it('summarizes per-tile runtime results into one status', () => {
        const live = { state: 'live', meta: { cache: 'hit', latencyMs: 10, attempts: 1, updated: '2026-11-12T10:00:00Z', networkState: 'online' } };
        const stale = { state: 'stale', meta: { cache: 'miss', latencyMs: 40, attempts: 2, updated: '2026-11-12T11:00:00Z', networkState: 'online' } };
        expect(summarizeTileResults([live, stale])).toEqual({
            state: 'stale',
            meta: { cache: 'partial', cacheAgeMs: 0, latencyMs: 40, attempts: 3, updated: '2026-11-12T11:00:00Z', networkState: 'online', tiles: 2 },
        });
    });

    it('names WMTS and Next Generation in the gibs source entry', () => {
        const gibs = SOURCE_DEFINITIONS.gibs;
        expect(JSON.stringify(gibs)).not.toMatch(/ShadedRelief|WMS GetMap/);
        expect(gibs.endpoint).toContain('BlueMarble_NextGeneration');
        expect(gibs.access.kind).toBe('public-wmts');
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
