// NASA GIBS WMTS, EPSG:4326 tile primitives.
// This module deliberately has no Three.js dependency so its URL, tile-math,
// queue and cache contracts can be verified independently from rendering.

export const GIBS_LAYERS = Object.freeze({
    dailyClouds: Object.freeze({
        id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
        matrixSet: '250m',
        extension: 'jpg',
        maxZoom: 8,
        temporal: true,
        attribution: 'NASA GIBS / VIIRS SNPP Corrected Reflectance True Color',
    }),
    trueColor: Object.freeze({
        id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
        matrixSet: '250m',
        extension: 'jpg',
        maxZoom: 8,
        temporal: true,
        attribution: 'NASA GIBS / MODIS Terra Corrected Reflectance True Color',
    }),
    blueMarble: Object.freeze({
        id: 'BlueMarble_ShadedRelief_Bathymetry',
        matrixSet: '500m',
        extension: 'jpeg',
        maxZoom: 8,
        temporal: false,
        attribution: 'NASA GIBS / Blue Marble Shaded Relief and Bathymetry',
    }),
    nightLights: Object.freeze({
        id: 'VIIRS_Black_Marble',
        matrixSet: '500m',
        extension: 'png',
        maxZoom: 8,
        temporal: true,
        attribution: 'NASA GIBS / VIIRS Black Marble annual nighttime lights',
    }),
});

// GIBS publishes the public WMTS endpoint on this canonical host. Keep the
// queue concurrency bounded; host sharding is not assumed to be available.
const GIBS_HOSTS = Object.freeze(['gibs']);

function assertIntegerInRange(value, name, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${name} must be an integer in [${min}, ${max}].`);
    }
}

export function tileGridDimensions(z) {
    assertIntegerInRange(z, 'z', 0, 8);
    return { columns: 2 * 2 ** z, rows: 2 ** z };
}

export function tileLatLonBounds(z, x, y) {
    const { columns, rows } = tileGridDimensions(z);
    assertIntegerInRange(x, 'x', 0, columns - 1);
    assertIntegerInRange(y, 'y', 0, rows - 1);
    const lonSpan = 360 / columns;
    const latSpan = 180 / rows;
    const west = -180 + x * lonSpan;
    const east = west + lonSpan;
    const north = 90 - y * latSpan;
    return { west, east, north, south: north - latSpan };
}

export function gibsTileUrl(layer, date, z, x, y) {
    if (!layer?.id || !layer.matrixSet || !layer.extension) throw new TypeError('A valid GIBS layer is required.');
    const { columns, rows } = tileGridDimensions(z);
    assertIntegerInRange(x, 'x', 0, columns - 1);
    assertIntegerInRange(y, 'y', 0, rows - 1);
    if (z > layer.maxZoom) throw new RangeError(`${layer.id} supports levels through z=${layer.maxZoom}.`);
    const time = layer.temporal ? date : 'default';
    if (layer.temporal && !/^\d{4}-\d{2}-\d{2}$/.test(time || '')) {
        throw new TypeError('Temporal GIBS layers require an ISO date (YYYY-MM-DD).');
    }
    const host = GIBS_HOSTS[(x + y) % GIBS_HOSTS.length];
    return `https://${host}.earthdata.nasa.gov/wmts/epsg4326/best/${layer.id}/default/${time}/${layer.matrixSet}/${z}/${y}/${x}.${layer.extension}`;
}

// WMS is a per-tile transport fallback for browsers or networks that reject a
// WMTS tile request. It preserves the same EPSG:4326 bounds and resolution.
export function gibsWmsTileUrl(layer, date, z, x, y) {
    const bounds = tileLatLonBounds(z, x, y);
    const params = new URLSearchParams({
        SERVICE: 'WMS',
        REQUEST: 'GetMap',
        VERSION: '1.3.0',
        LAYERS: layer.id,
        STYLES: '',
        FORMAT: layer.extension === 'png' ? 'image/png' : 'image/jpeg',
        TRANSPARENT: 'false',
        HEIGHT: '512',
        WIDTH: '512',
        CRS: 'EPSG:4326',
        BBOX: `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`,
    });
    if (layer.temporal) params.set('TIME', date);
    return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params}`;
}

export function gibsTileKey(layer, date, z, x, y) {
    return `${layer.id}:${layer.temporal ? date : 'default'}:${z}:${x}:${y}`;
}

export class LruTileCache {
    constructor(limit = 400) {
        if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Cache limit must be a positive integer.');
        this.limit = limit;
        this.entries = new Map();
    }

    get(key) {
        const value = this.entries.get(key);
        if (!value) return null;
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }

    set(key, value) {
        const previous = this.entries.get(key);
        if (previous && previous !== value) previous.dispose?.();
        this.entries.delete(key);
        this.entries.set(key, value);
        while (this.entries.size > this.limit) {
            const [oldestKey, oldest] = this.entries.entries().next().value;
            this.entries.delete(oldestKey);
            oldest.dispose?.();
        }
    }

    clear() {
        for (const value of this.entries.values()) value.dispose?.();
        this.entries.clear();
    }
}

export class GibsTileQueue {
    constructor({ load, concurrency = 12 }) {
        if (typeof load !== 'function') throw new TypeError('GibsTileQueue requires a load function.');
        if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('concurrency must be a positive integer.');
        this.load = load;
        this.concurrency = concurrency;
        this.active = 0;
        this.pending = [];
        this.tasks = new Map();
    }

    request(key, url, priority = 0) {
        const existing = this.tasks.get(key);
        if (existing) return existing.promise;
        let resolve;
        let reject;
        const task = { key, url, priority, resolve: null, reject: null, promise: new Promise((ok, fail) => { resolve = ok; reject = fail; }) };
        task.resolve = resolve;
        task.reject = reject;
        this.tasks.set(key, task);
        this.pending.push(task);
        this.#drain();
        return task.promise;
    }

    #drain() {
        while (this.active < this.concurrency && this.pending.length) {
            this.pending.sort((a, b) => b.priority - a.priority);
            const task = this.pending.shift();
            this.active++;
            Promise.resolve(this.load(task.url))
                .then(task.resolve, task.reject)
                .finally(() => {
                    this.active--;
                    this.tasks.delete(task.key);
                    this.#drain();
                });
        }
    }
}

// Compose a fixed GIBS level into one equirectangular raster before it reaches
// Three.js.  This is intentionally different from mapping one mesh per tile:
// there can be no UV gaps, z-fighting, or floating-point cracks between tiles.
// The caller owns image loading so this module stays browser/renderer agnostic.
export async function composeGibsEquirectangularMosaic({
    layer,
    date,
    z = 1,
    tileSize = 512,
    loadImage,
    concurrency = 8
}) {
    if (typeof loadImage !== 'function') throw new TypeError('composeGibsEquirectangularMosaic requires loadImage(url).');
    if (!Number.isInteger(tileSize) || tileSize < 1) throw new RangeError('tileSize must be a positive integer.');
    const { columns, rows } = tileGridDimensions(z);
    if (z > layer.maxZoom) throw new RangeError(`${layer.id} supports levels through z=${layer.maxZoom}.`);

    const canvas = document.createElement('canvas');
    canvas.width = columns * tileSize;
    canvas.height = rows * tileSize;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Unable to create GIBS mosaic canvas.');

    const queue = new GibsTileQueue({
        concurrency,
        load: async (url) => loadImage(url)
    });
    const tasks = [];
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
            const key = gibsTileKey(layer, date, z, x, y);
            const nativeUrl = gibsTileUrl(layer, date, z, x, y);
            const fallbackUrl = gibsWmsTileUrl(layer, date, z, x, y);
            tasks.push(
                queue.request(key, nativeUrl, 0)
                    .catch(() => queue.request(`${key}:wms`, fallbackUrl, 0))
                    .then((image) => ({ x, y, image }))
            );
        }
    }

    const tiles = await Promise.all(tasks);
    for (const { x, y, image } of tiles) {
        ctx.drawImage(image, x * tileSize, y * tileSize, tileSize, tileSize);
    }
    return { canvas, columns, rows, z, tileSize };
}
