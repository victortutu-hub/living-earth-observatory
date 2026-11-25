// LOT 42: Terrarium relief for the shading normals near the globe (step B of LOT 40), land only.
// ETOPO 2022 (1/6 deg, ~18.5 km) stays the global relief, the displacement and the ocean; below distance 4.6 the
// visible area gets AWS Terrain Tiles (Terrarium, Mapzen / Tilezen joerd) at z5-z7, chosen from the screen pixel
// (touch: z6 at most). They replace the ETOPO slopes in the relief normal where they are sharper, on land only
// (the relief weight is already land x Sun; the sea floor never tilts the normal).
//
//   Tiles      Web Mercator, 256 px, fetched through the shared request runtime; the tile maths and the decoding
//              come from src/himalaya/terrarium.js. The window, debounce, cancellation, LRU, slot table and
//              uploads are the shared tile-window layer of gibs-regional-surface.js (LOT 41), source "Terrarium".
//   Worker     the PNG bytes are decoded and the slopes prepared in terrarium-worker.js (owned by the layer,
//              terminated on dispose); the main thread only copies the prepared mip chain into the atlas
//              (one tile per frame). Without Worker / OffscreenCanvas the same preparation runs inline.
//   Sampling   per fragment, from the geographic lat / lon of the globe: x = (lon + 180) / 360 * 2^z,
//              y = (1 - ln(tan(pi/4 + lat/2)) / pi) / 2 * 2^z (Web Mercator, exact: no stretching at high
//              latitude). Valid up to |lat| <= 85.0511 deg (the Web Mercator limit); beyond it ETOPO only.
//   Stored     the SLOPES, not the heights: east / north dh/ds in m/m (RG16F), from central differences over the
//              real ground distance of a Mercator pixel at its row (R cos(lat) * 360 / (256 * 2^z) deg; the pixel is
//              square on the ground). The mip chain is the box average of the slopes, computed in the worker
//              (generating mipmaps of a float texture needs a colour-renderable float format, not guaranteed on phones).
//   Anomalies  (terrarium-prep.js cleanTerrariumHeights) a height outside [-450 m, 8900 m] (lowest dry land: Dead Sea
//              shore ~ -430 m; Everest 8849 m) or more than max(300 m, one pixel of ground distance) away from the
//              median of its 8 neighbours (a one-pixel step steeper than 45 deg against all its neighbours: voids and
//              spikes, e.g. a -489 m column in 2370 m terrain at z15, -810 m in Lake Garda at z7) is replaced by the
//              median of its valid neighbours. Negative heights are then 0 m for the slopes (the sea of the tiles is
//              ETOPO1 bathymetry; ETOPO 2022 keeps the ocean).
//   Gain       G = max(1, G_ETOPO * texel / texel_ETOPO) with texel the angular size of the sampled texel (the mip
//              level included): G = 30 at the ETOPO texel (the old result, unchanged), smaller for finer texels,
//              1 (physical slopes, as on the Moon) at 1/30 of it. Lat-independent: both grids shrink east-west by
//              cos(lat). z5 7.9, z6 4.0, z7 2.0 at full resolution.
import { createTileWindowLayer } from './gibs-regional-surface.js';
import { RELIEF_LINEAR_ASSETS, RELIEF_SHADING_GAIN } from './relief-linear.js';
import { createRequestRuntime } from '../core/runtime/request-runtime.js';
import { NON_PERSISTENT_CACHE } from '../core/sky/sky-assets.js';
import { decodeTerrarium, latToTileY, lonToTileX, terrariumUrl } from '../himalaya/terrarium.js';
import { EARTH_RADIUS_KM, TERRAIN_TILE_SIZE, mercatorPixelKm, prepareTerrainHeights } from './terrarium-prep.js';

export {
    TERRAIN_HEIGHT_BOUNDS_M, TERRAIN_SPIKE_MIN_M, TERRAIN_TILE_SIZE, cleanTerrariumHeights, mercatorPixelKm,
    prepareTerrainHeights, rowPixelMetres, slopeMipChain, terrariumSlopes, toHalfBits,
} from './terrarium-prep.js';

export const MERCATOR_MAX_LAT = 85.0511287798;
/** ETOPO texel, north-south (the coarse size of the 1/6 deg grid). */
export const ETOPO_TEXEL_KM = Math.PI * EARTH_RADIUS_KM / RELIEF_LINEAR_ASSETS.height;
export const TERRAIN_LABEL = 'reconstructed DEM (Terrarium, Mapzen / Tilezen joerd: GMTED2010 at z5-z6, SRTM at z7, GMTED2010 above 60°)';

export const TERRAIN_POLICY = Object.freeze({
    activationDistance: 4.6, // as the regional surface: beyond it nothing is requested or changed
    fullWeightDistance: 4.3,
    minLevel: 5,
    debounceMs: 300,
    uploadsPerFrame: 1, // the copy of a prepared mip chain (9 small texSubImage2D)
    fadeInMs: 400,
    tileTimeoutMs: Object.freeze([20_000, 30_000]),
    retries: 1,
    backoffMs: Object.freeze([1000]),
    grid: Object.freeze([32, 18]),
    // slots: atlas side in tiles of 256 px, RG16F + mips (desktop 2560^2 ~ 33 MB, touch 1536^2 ~ 12 MB).
    desktop: Object.freeze({ maxLevel: 7, slots: 10, concurrency: 6, lruTiles: 32 }),
    touch: Object.freeze({ maxLevel: 6, slots: 6, concurrency: 4, lruTiles: 8 }),
});

export function terrainProfile({ touch = false, pixelRatio = 1, policy = TERRAIN_POLICY } = {}) {
    return { ...(touch ? policy.touch : policy.desktop), touch, pixelRatio };
}

/** The coarsest level whose pixel is <= the footprint at that latitude; null when ETOPO is already enough. */
export function terrainLevelFor(footprintKm, lat, maxLevel, minLevel = TERRAIN_POLICY.minLevel) {
    if (!(footprintKm < ETOPO_TEXEL_KM)) return null;
    for (let level = minLevel; level <= maxLevel; level++) if (mercatorPixelKm(level, lat) <= footprintKm) return level;
    return maxLevel;
}

/** Continuous Web Mercator tile coordinates of a point (the shader does the same per fragment). */
export function mercatorTileCoords(level, lat, lon) {
    return { x: lonToTileX(lon, level), y: latToTileY(lat, level) };
}

/** log2(ETOPO texel / Terrarium pixel), angular: the mip level at which the tiles are no sharper than ETOPO. */
export function terrainBaseLod(level) {
    return Math.log2(TERRAIN_TILE_SIZE * 2 ** level / RELIEF_LINEAR_ASSETS.width);
}

/** JS mirror of the shader gain: G_ETOPO at the ETOPO texel, 1 (physical) at <= 1/G_ETOPO of it. */
export function terrainShadingGain(level, lod = 0, etopoGain = RELIEF_SHADING_GAIN) {
    return Math.max(1, etopoGain * 2 ** (lod - terrainBaseLod(level)));
}

export const TERRARIUM_WINDOW_SOURCE = Object.freeze({
    covers: (hit) => Math.abs(hit.lat) <= MERCATOR_MAX_LAT,
    levelFor: (footprintKm, lat, maxLevel, minLevel) => terrainLevelFor(footprintKm, lat, maxLevel, minLevel),
    needs: (hit) => hit.footprintKm < ETOPO_TEXEL_KM,
    grid: (level) => ({ columns: 2 ** level, rows: 2 ** level }),
    tileOf: (level, hit) => {
        const n = 2 ** level;
        const { x, y } = mercatorTileCoords(level, hit.lat, hit.lon);
        return { x: Math.min(n - 1, Math.max(0, Math.floor(x))), y: Math.min(n - 1, Math.max(0, Math.floor(y))) };
    },
});

/** Level / column / row of a Terrarium tile URL. */
export function parseTerrariumUrl(url) {
    const m = /\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
    if (!m) throw new Error(`Not a Terrarium tile URL: ${url}`);
    return { level: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
}

/** Suffix of the #surfaceStatus line ('' when off). */
export function describeTerrainStatus(status) {
    if (!status || status.state === 'off') return '';
    const z = `relief detail z${status.level}`;
    if (status.state === 'unavailable') return ` · ${z} unavailable (${status.failed} tiles failed) — ETOPO shown`;
    if (status.state === 'partial') return ` · ${z}: ${status.failed} of ${status.wanted} tiles unavailable — ETOPO shown there; ${TERRAIN_LABEL}`;
    if (status.state === 'loading') return ` · ${z} loading (${status.resident}/${status.wanted} tiles); ${TERRAIN_LABEL}`;
    return ` · ${z} (${status.resident}/${status.wanted} tiles); ${TERRAIN_LABEL}`;
}

let sharedRuntime = null;
/** Blob -> ImageBitmap with no colour conversion (the bytes are heights), through the shared request runtime. */
export async function loadTerrariumBitmap(url, { signal = null, runtime = null } = {}) {
    if (!runtime && !sharedRuntime) sharedRuntime = createRequestRuntime({ cache: NON_PERSISTENT_CACHE });
    const result = await (runtime || sharedRuntime).fetchResource({
        key: `terrarium-tile:${url}`, url, responseType: 'blob', ttl: 0, staleTtl: 0, timeout: 0, retries: 0, signal,
        fetchOptions: { mode: 'cors', priority: 'low' },
    });
    try {
        return await createImageBitmap(result.data, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch (error) {
        const decodeError = new Error(`Terrarium tile could not be decoded: ${url} (${error?.message || error})`);
        decodeError.tileReason = 'decode';
        throw decodeError;
    }
}

function inlinePrepare(bitmap, level, tileY) {
    const { width, height } = bitmap;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const heights = decodeTerrarium(context.getImageData(0, 0, width, height).data, width, height);
    bitmap.close?.();
    return prepareTerrainHeights(heights, width, level, tileY);
}

const defaultWorker = () => (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
    ? new Worker(new URL('./terrarium-worker.js', import.meta.url), { type: 'module' })
    : null);

/**
 * The worker that prepares the tiles (owned: dispose() terminates it and rejects what is pending). Without a
 * worker (or after a worker error) the preparation runs inline on the main thread.
 */
export function createTerrainPreparer({ createWorker = defaultWorker, prepareInline = inlinePrepare } = {}) {
    let worker = null;
    try { worker = createWorker(); } catch { worker = null; }
    const pending = new Map();
    let seq = 0;
    const failAll = (error) => { pending.forEach((p) => p.reject(error)); pending.clear(); };
    if (worker) {
        worker.onmessage = ({ data }) => {
            const p = pending.get(data.id);
            if (!p) return;
            pending.delete(data.id);
            if (data.error) p.reject(new Error(`Terrarium tile preparation failed: ${data.error}`));
            else p.resolve({ levels: data.levels, replaced: data.replaced });
        };
        worker.onerror = (event) => {
            event?.preventDefault?.();
            worker.terminate();
            worker = null; // next tiles: inline
            failAll(new Error(`Terrarium worker error: ${event?.message || 'unknown'}`));
        };
    }
    return {
        get usesWorker() { return Boolean(worker); },
        prepare(bitmap, level, tileY) {
            if (!worker) return Promise.resolve().then(() => prepareInline(bitmap, level, tileY));
            return new Promise((resolve, reject) => {
                const id = ++seq;
                pending.set(id, { resolve, reject });
                worker.postMessage({ id, bitmap, level, tileY }, [bitmap]);
            });
        },
        dispose() {
            worker?.terminate();
            worker = null;
            failAll(new DOMException('terrain preparer disposed', 'AbortError'));
        },
    };
}

export function terrariumTileSource({ load, preparer = null }) {
    return {
        ...TERRARIUM_WINDOW_SOURCE,
        tileSize: TERRAIN_TILE_SIZE,
        url: (level, x, y) => terrariumUrl(level, x, y),
        load,
        alive: (payload) => Array.isArray(payload?.levels),
        release: () => {},
        dispose: () => preparer?.dispose(),
        debugState: () => ({ worker: Boolean(preparer?.usesWorker) }),
        gridUniform: (level) => 2 ** level, // tiles per side
        baseLod: (level) => terrainBaseLod(level),
        atlasBytes: (size) => Math.round(size * size * 4 * 4 / 3),
        createAtlas(T, renderer, size) {
            const atlas = new T.DataTexture(null, size, size, T.RGFormat, T.HalfFloatType);
            atlas.source.dataReady = false; // storage only; every mip level is copied in per tile
            atlas.generateMipmaps = false;
            atlas.minFilter = T.LinearMipmapLinearFilter;
            atlas.magFilter = T.LinearFilter;
            atlas.wrapS = atlas.wrapT = T.ClampToEdgeWrapping;
            atlas.flipY = false; // row 0 = the north edge of a tile
            for (let s = size; s >= 1; s >>= 1) atlas.mipmaps.push({ data: null, width: s, height: s });
            atlas.needsUpdate = true;
            renderer.initTexture?.(atlas);
            return atlas;
        },
        upload({ THREE: T, renderer, atlas, payload, x, y }) {
            payload.levels.forEach((level, k) => {
                const source = new T.DataTexture(level.data, level.size, level.size, T.RGFormat, T.HalfFloatType);
                renderer.copyTextureToTexture(source, atlas, null, { x: x >> k, y: y >> k, z: 0 }, 0, k);
            });
        },
    };
}

/** GLSL: declarations (fragment <common>) and the slope blend inside the relief normal (after the ETOPO slope). */
export const TERRAIN_FRAGMENT_PARS = `
        uniform float uTerrainOnTw;
        uniform float uTerrainFadeTw;
        uniform float uTerrainBaseLodTw;
        uniform sampler2D uTerrainAtlasTw;
        uniform sampler2D uTerrainTableTw;
        uniform vec4 uTerrainGridTw;   // tiles per side (2^z), columns, slots per side, level
        uniform vec4 uTerrainWindowTw; // first column (wraps), first row, width, height (tiles)`;
export const TERRAIN_SLOPE_MARKER = '// LOT 42: terrain slope';
export const TERRAIN_FRAGMENT_BODY = `
                if (uTerrainOnTw > 0.5) {
                    // LOT 42: Terrarium slopes (land only through the relief weight), Web Mercator sampled per fragment.
                    float terLatTw = vMapUv.y * 180.0 - 90.0;
                    float terLatRTw = radians(clamp(terLatTw, -85.0511, 85.0511));
                    vec2 terTileTw = vec2(vMapUv.x, (1.0 - log(tan(0.25 * PI + 0.5 * terLatRTw)) / PI) * 0.5) * uTerrainGridTw.x;
                    vec2 terPxTw = terTileTw * 256.0;
                    vec2 terDxTw = dFdx(terPxTw);
                    vec2 terDyTw = dFdy(terPxTw);
                    float terLodTw = 0.5 * log2(max(max(dot(terDxTw, terDxTw), dot(terDyTw, terDyTw)), 1e-8));
                    vec2 terCellTw = floor(terTileTw);
                    vec2 terFracTw = terTileTw - terCellTw;
                    float terUxTw = uTerrainWindowTw.x + mod(terCellTw.x - uTerrainWindowTw.x, uTerrainGridTw.y);
                    vec2 terLocalTw = vec2(terUxTw, terCellTw.y) - uTerrainWindowTw.xy;
                    float terInsideTw = step(0.0, terLocalTw.x) * step(0.0, terLocalTw.y)
                        * step(terLocalTw.x, uTerrainWindowTw.z - 1.0) * step(terLocalTw.y, uTerrainWindowTw.w - 1.0);
                    vec2 terSlotTw = mod(vec2(terUxTw, terCellTw.y), uTerrainGridTw.z);
                    vec4 terEntryTw = texelFetch(uTerrainTableTw, ivec2(terSlotTw), 0) * 255.0;
                    float terMatchTw = step(abs(terEntryTw.r - terCellTw.x), 0.5) * step(abs(terEntryTw.g - terCellTw.y), 0.5)
                        * step(abs(terEntryTw.b - uTerrainGridTw.w), 0.5);
                    float terLodSTw = clamp(terLodTw, 0.0, uTerrainBaseLodTw);
                    float terInsetTw = 0.5 * exp2(ceil(terLodSTw));
                    vec2 terInTileTw = clamp(terFracTw * 256.0, vec2(terInsetTw), vec2(256.0 - terInsetTw));
                    vec2 terSlopeTw = textureLod(uTerrainAtlasTw, (terSlotTw * 256.0 + terInTileTw) / (uTerrainGridTw.z * 256.0), terLodSTw).rg;
                    // G = G_ETOPO x (texel / ETOPO texel), angular: G_ETOPO at the base lod, 1 (physical) at 1/G_ETOPO.
                    float terGainTw = max(1.0, uShadingGainTw * exp2(terLodSTw - uTerrainBaseLodTw));
                    vec2 terInWindowTw = terLocalTw + terFracTw;
                    float terEdgeTw = min(min(terInWindowTw.x, uTerrainWindowTw.z - terInWindowTw.x), min(terInWindowTw.y, uTerrainWindowTw.w - terInWindowTw.y));
                    float terWeightTw = terInsideTw * terMatchTw * (terEntryTw.a / 255.0) * smoothstep(0.0, 0.35, terEdgeTw)
                        * (1.0 - smoothstep(uTerrainBaseLodTw - 1.0, uTerrainBaseLodTw, terLodTw)) * uTerrainFadeTw
                        * step(abs(terLatTw), 85.0511);
                    reliefSlopeTw = mix(reliefSlopeTw, terGainTw * terSlopeTw, terWeightTw);
                }`;

/** Adds the Terrarium slopes to an Earth material shader (after the relief normal body is in place). */
export function injectTerrainRelief(shader, terrain) {
    if (!terrain?.uniforms || !shader.fragmentShader.includes(TERRAIN_SLOPE_MARKER)) return;
    Object.assign(shader.uniforms, terrain.uniforms);
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${TERRAIN_FRAGMENT_PARS}`)
        .replace(TERRAIN_SLOPE_MARKER, TERRAIN_FRAGMENT_BODY);
}

/**
 * The Terrarium relief layer on the shared tile-window runtime (uniforms uTerrain*Tw). `loadImage(url, { signal })`
 * resolves with a prepared payload ({ levels, replaced }); by default: fetch + decode the bitmap, prepare it in the
 * worker. `preparer` is owned by the layer (terminated on dispose).
 */
export function createTerrainRelief({
    THREE,
    renderer,
    touch = false,
    pixelRatio = () => renderer.getPixelRatio?.() ?? 1,
    preparer = null,
    loadImage = null,
    signal = null,
    now = () => performance.now(),
    policy = TERRAIN_POLICY,
    onStatus = null,
}) {
    const owned = loadImage ? preparer : (preparer || createTerrainPreparer());
    const load = loadImage || (async (url, { signal: tileSignal } = {}) => {
        const { level, y } = parseTerrariumUrl(url);
        const bitmap = await loadTerrariumBitmap(url, { signal: tileSignal });
        if (tileSignal?.aborted) { bitmap.close?.(); throw tileSignal.reason || new DOMException('Aborted', 'AbortError'); }
        return owned.prepare(bitmap, level, y);
    });
    return createTileWindowLayer({
        THREE, renderer, source: terrariumTileSource({ load, preparer: owned }), prefix: 'uTerrain',
        profileFor: (ratio) => terrainProfile({ touch, pixelRatio: ratio, policy }),
        pixelRatio, signal, now, policy, describe: describeTerrainStatus, onStatus,
    });
}
