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
    // Unshaded surface composite (no baked hillshade; see gibs-surface.js).
    blueMarble: Object.freeze({
        id: 'BlueMarble_NextGeneration',
        matrixSet: '500m',
        extension: 'jpeg',
        maxZoom: 7,
        temporal: false,
        attribution: 'NASA GIBS / Blue Marble Next Generation',
    }),
    nightLights: Object.freeze({
        id: 'VIIRS_Black_Marble',
        matrixSet: '500m',
        extension: 'png',
        maxZoom: 7,
        temporal: true,
        attribution: 'NASA GIBS / VIIRS Black Marble annual nighttime lights',
    }),
});

// GIBS EPSG:4326 TileMatrixSets, copied level by level from the WMTS
// GetCapabilities document
//   https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml
// (read 2026-11-12). Every set has TopLeftCorner (-180, 90) and 512x512 px
// tiles. Each entry is [MatrixWidth, MatrixHeight, tile span in degrees]
// (span = ScaleDenominator * 0.28 mm * 512 / 111319.49 m per degree).
// The matrix does NOT tile the globe evenly at the coarse levels: at z=0 two
// tiles of 288 deg overhang 360 x 180; it fits exactly only from z=3 (10 x 5
// tiles of 36 deg). Tiles beyond the globe are padding and are cropped away.
export const GIBS_TILE_SIZE = 512;
export const GIBS_EPSG4326_TILE_MATRIX_SETS = Object.freeze({
    '16km': Object.freeze([[2, 1, 288], [3, 2, 144], [5, 3, 72]]),
    '2km': Object.freeze([[2, 1, 288], [3, 2, 144], [5, 3, 72], [10, 5, 36], [20, 10, 18], [40, 20, 9]]),
    '1km': Object.freeze([[2, 1, 288], [3, 2, 144], [5, 3, 72], [10, 5, 36], [20, 10, 18], [40, 20, 9], [80, 40, 4.5]]),
    '500m': Object.freeze([[2, 1, 288], [3, 2, 144], [5, 3, 72], [10, 5, 36], [20, 10, 18], [40, 20, 9], [80, 40, 4.5],
        [160, 80, 2.25]]),
    '250m': Object.freeze([[2, 1, 288], [3, 2, 144], [5, 3, 72], [10, 5, 36], [20, 10, 18], [40, 20, 9], [80, 40, 4.5],
        [160, 80, 2.25], [320, 160, 1.125]]),
    '31.25m': Object.freeze([[2, 1, 288], [3, 2, 144], [5, 3, 72], [10, 5, 36], [20, 10, 18], [40, 20, 9], [80, 40, 4.5],
        [160, 80, 2.25], [320, 160, 1.125], [640, 320, 0.5625], [1280, 640, 0.28125], [2560, 1280, 0.140625]]),
    '15.625m': Object.freeze([[2, 1, 288], [3, 2, 144], [5, 3, 72], [10, 5, 36], [20, 10, 18], [40, 20, 9], [80, 40, 4.5],
        [160, 80, 2.25], [320, 160, 1.125], [640, 320, 0.5625], [1280, 640, 0.28125], [2560, 1280, 0.140625],
        [5120, 2560, 0.0703125]]),
});

// GIBS publishes the public WMTS endpoint on this canonical host. Keep the
// queue concurrency bounded; host sharding is not assumed to be available.
const GIBS_HOSTS = Object.freeze(['gibs']);

function assertIntegerInRange(value, name, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${name} must be an integer in [${min}, ${max}].`);
    }
}

function matrixLevels(matrixSet) {
    const levels = GIBS_EPSG4326_TILE_MATRIX_SETS[matrixSet];
    if (!levels) throw new RangeError(`Unknown GIBS EPSG:4326 TileMatrixSet: ${matrixSet}.`);
    return levels;
}

/** Full WMTS matrix at level z: tile counts and the span of one tile in degrees. */
export function tileGridDimensions(matrixSet, z) {
    const levels = matrixLevels(matrixSet);
    assertIntegerInRange(z, 'z', 0, levels.length - 1);
    const [columns, rows, tileSpanDeg] = levels[z];
    return { columns, rows, tileSpanDeg };
}

/** Geographic bounds of one tile; padding tiles extend past 180 E / 90 S. */
export function tileLatLonBounds(matrixSet, z, x, y) {
    const { columns, rows, tileSpanDeg } = tileGridDimensions(matrixSet, z);
    assertIntegerInRange(x, 'x', 0, columns - 1);
    assertIntegerInRange(y, 'y', 0, rows - 1);
    const west = -180 + x * tileSpanDeg;
    const north = 90 - y * tileSpanDeg;
    return { west, east: west + tileSpanDeg, north, south: north - tileSpanDeg };
}

/**
 * The part of level z that covers the globe: the tiles to request and the
 * pixel size of the 360 x 180 crop (e.g. 500m z2 -> 5 x 3 tiles, 2560 x 1280).
 */
export function gibsGlobeCoverage(matrixSet, z) {
    const { tileSpanDeg } = tileGridDimensions(matrixSet, z);
    return {
        columns: Math.ceil(360 / tileSpanDeg - 1e-9),
        rows: Math.ceil(180 / tileSpanDeg - 1e-9),
        width: Math.round(360 / tileSpanDeg * GIBS_TILE_SIZE),
        height: Math.round(180 / tileSpanDeg * GIBS_TILE_SIZE),
        tileSpanDeg,
    };
}

export function gibsTileUrl(layer, date, z, x, y) {
    if (!layer?.id || !layer.matrixSet || !layer.extension) throw new TypeError('A valid GIBS layer is required.');
    const { columns, rows } = tileGridDimensions(layer.matrixSet, z);
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

function abortError(signal) {
    return signal?.reason || new DOMException('Aborted', 'AbortError');
}

const pageDocument = () => (typeof document !== 'undefined' ? document : null);

/**
 * A timeout that counts only time while the page is visible. Browsers throttle
 * timers and image decoding in hidden tabs, so a wall-clock timeout would
 * expire on tiles that have already downloaded (LOT 4b-B, found at deploy).
 * The countdown pauses on `visibilitychange` to hidden and resumes with the
 * remaining time when the page is visible again. cancel() always detaches.
 */
export function visibleTimeout(ms, onTimeout, doc = pageDocument()) {
    let remaining = ms;
    let startedAt = 0;
    let timer = null;
    let done = false;
    const isHidden = () => Boolean(doc?.hidden);
    const detach = () => doc?.removeEventListener?.('visibilitychange', onVisibility);
    const start = () => {
        if (done || timer !== null) return;
        startedAt = Date.now();
        timer = setTimeout(() => {
            timer = null;
            done = true;
            detach();
            onTimeout();
        }, remaining);
    };
    const pause = () => {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    function onVisibility() {
        if (isHidden()) pause();
        else start();
    }
    doc?.addEventListener?.('visibilitychange', onVisibility);
    if (!isHidden()) start();
    return {
        cancel() {
            done = true;
            if (timer !== null) clearTimeout(timer);
            timer = null;
            detach();
        },
    };
}

/** Records whether the page was hidden at any moment while a load ran. */
export function watchPageVisibility(doc = pageDocument()) {
    let hidden = Boolean(doc?.hidden);
    const onVisibility = () => { if (doc.hidden) hidden = true; };
    doc?.addEventListener?.('visibilitychange', onVisibility);
    return {
        wasHidden: () => hidden,
        stop: () => doc?.removeEventListener?.('visibilitychange', onVisibility),
    };
}

/** Resolves when the page is visible (immediately if it already is). */
export function whenVisible(doc = pageDocument()) {
    if (!doc?.hidden) return Promise.resolve();
    return new Promise((resolve) => {
        const onVisibility = () => {
            if (doc.hidden) return;
            doc.removeEventListener('visibilitychange', onVisibility);
            resolve();
        };
        doc.addEventListener('visibilitychange', onVisibility);
    });
}

/**
 * One tile attempt bounded by timeoutMs of visible time, retried `retries`
 * times. The timer is always cancelled; an abort is never retried.
 */
export async function loadTileWithRetry(loadImage, url, { timeoutMs = 15_000, retries = 1, signal = null, doc = pageDocument() } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted) throw abortError(signal);
        let timeout = null;
        try {
            return await Promise.race([
                Promise.resolve().then(() => loadImage(url, { timeoutMs, signal, doc })),
                new Promise((_, reject) => {
                    timeout = visibleTimeout(timeoutMs, () => reject(new Error(`GIBS tile timed out after ${timeoutMs} ms: ${url}`)), doc);
                }),
            ]);
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            lastError = error;
        } finally {
            timeout?.cancel();
        }
    }
    throw lastError;
}

/** Browser tile loader: decoded <img>; the request is dropped on timeout or abort. */
export function loadGibsTileImage(url, { timeoutMs = 15_000, signal = null, doc = pageDocument() } = {}) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            timeout.cancel();
            signal?.removeEventListener('abort', onAbort);
            if (error) {
                image.src = '';
                reject(error);
            } else {
                resolve(image);
            }
        };
        const onAbort = () => finish(abortError(signal));
        const timeout = visibleTimeout(timeoutMs, () => finish(new Error(`GIBS tile timed out after ${timeoutMs} ms`)), doc);
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.src = url;
        image.decode().then(() => finish(null), () => finish(new Error(`GIBS tile failed to load: ${url}`)));
    });
}

function defaultCreateCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

// Compose one fixed GIBS level into a single equirectangular raster, cropped
// to 360 x 180, before it reaches the renderer: no UV gaps, z-fighting or
// cracks between tiles. Only tiles that intersect the globe are requested.
// Each tile gets its own timeout and retries; there is no per-tile WMS
// fallback (WMS is the slow GIBS service). Any tile failing after its retries
// rejects the whole mosaic, so a partial globe is never shown as observed
// imagery. outputSize, if given, resamples the crop (e.g. z3 5120 -> 4096).
export async function composeGibsEquirectangularMosaic({
    layer,
    date,
    z = 1,
    loadImage = loadGibsTileImage,
    concurrency = 8,
    tileTimeoutMs = 15_000,
    retries = 1,
    outputSize = null,
    createCanvas = defaultCreateCanvas,
    signal = null,
    doc = pageDocument(),
}) {
    if (typeof loadImage !== 'function') throw new TypeError('composeGibsEquirectangularMosaic requires loadImage(url).');
    if (z > layer.maxZoom) throw new RangeError(`${layer.id} supports levels through z=${layer.maxZoom}.`);
    const coverage = gibsGlobeCoverage(layer.matrixSet, z);
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const canvas = createCanvas(coverage.width, coverage.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Unable to create GIBS mosaic canvas.');

    const queue = new GibsTileQueue({
        concurrency,
        load: (url) => loadTileWithRetry(loadImage, url, { timeoutMs: tileTimeoutMs, retries, signal, doc }),
    });
    const tasks = [];
    for (let y = 0; y < coverage.rows; y++) {
        for (let x = 0; x < coverage.columns; x++) {
            const url = gibsTileUrl(layer, date, z, x, y);
            tasks.push(queue.request(gibsTileKey(layer, date, z, x, y), url, 0).then((image) => {
                // Padding past 180 E / 90 S falls outside the canvas and is clipped.
                ctx.drawImage(image, x * GIBS_TILE_SIZE, y * GIBS_TILE_SIZE, GIBS_TILE_SIZE, GIBS_TILE_SIZE);
                image.close?.();
            }));
        }
    }
    await Promise.all(tasks);
    if (signal?.aborted) throw abortError(signal);

    let output = canvas;
    if (outputSize && (outputSize.width !== coverage.width || outputSize.height !== coverage.height)) {
        output = createCanvas(outputSize.width, outputSize.height);
        const outputCtx = output.getContext('2d', { alpha: false });
        if (!outputCtx) throw new Error('Unable to create GIBS output canvas.');
        outputCtx.imageSmoothingEnabled = true;
        outputCtx.imageSmoothingQuality = 'high';
        outputCtx.drawImage(canvas, 0, 0, outputSize.width, outputSize.height);
        canvas.width = 0; // release the full-resolution crop
        canvas.height = 0;
    }
    const finished = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
        canvas: output,
        z,
        columns: coverage.columns,
        rows: coverage.rows,
        tiles: tasks.length,
        sourceWidth: coverage.width,
        sourceHeight: coverage.height,
        width: output.width,
        height: output.height,
        tileSize: GIBS_TILE_SIZE,
        elapsedMs: Math.round(finished - started),
    };
}
