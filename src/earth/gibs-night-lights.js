// NASA GIBS Black Marble is an observed annual nighttime-light composite.
// Loaded from WMTS tiles (LOT 4b-A): level z2 of the 500m set, 5 x 3 tiles
// cropped to 360 x 180 (2560 x 1280). It is a single seamless composite, so
// the tiles join without seams; WMS (wms.cgi) is no longer used because it
// answered in 45-160 s or 504 (measured 2026-11-12). The local texture
// remains the startup/failure fallback.
import { EARTH_TEMPORAL_LAYERS } from './temporal-provenance.js';
import { GIBS_LAYERS, GIBS_TILE_POLICY, composeGibsEquirectangularMosaic } from './gibs-tiles.js';
import { loadGibsTileBitmap } from './gibs-tile-loader.js';

export const BLACK_MARBLE_LEVEL = 2;
// LOT 24: same per-tile path as the surface (a new request per attempt, 20 s / 30 s / 45 s, 2 retries with backoff);
// still all-or-nothing: a failed tile keeps the local night-lights texture (no background rounds).
export const BLACK_MARBLE_TILE_POLICY = Object.freeze({ concurrency: 8, tileTimeoutMs: GIBS_TILE_POLICY.timeoutMs, retries: GIBS_TILE_POLICY.retries, backoffMs: GIBS_TILE_POLICY.backoffMs });

export async function loadBlackMarbleTexture({
    THREE,
    renderer,
    year = 2016,
    z = BLACK_MARBLE_LEVEL,
    loadImage = loadGibsTileBitmap, // LOT 24
    createCanvas,
    signal = null,
    policy = BLACK_MARBLE_TILE_POLICY,
}) {
    if (year !== 2012 && year !== 2016) throw new RangeError('NASA GIBS Black Marble is available here for 2012 or 2016.');
    const mosaic = await composeGibsEquirectangularMosaic({
        layer: GIBS_LAYERS.nightLights,
        date: `${year}-01-01`,
        z,
        concurrency: policy.concurrency,
        tileTimeoutMs: policy.tileTimeoutMs,
        retries: policy.retries,
        backoffMs: policy.backoffMs,
        loadImage,
        ...(createCanvas ? { createCanvas } : {}),
        signal,
    });
    const texture = new THREE.CanvasTexture(mosaic.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    texture.userData.temporal = createBlackMarbleTemporal(year);
    texture.userData.gibsLevel = z;
    texture.userData.gibsTiles = mosaic.tiles;
    texture.userData.gibsElapsedMs = mosaic.elapsedMs;
    texture.userData.resolution = `${mosaic.width}x${mosaic.height}`;
    return texture;
}

function createBlackMarbleTemporal(year) {
    return Object.freeze({ ...EARTH_TEMPORAL_LAYERS.blackMarble, sourceTime: `${year}-01-01T00:00:00.000Z` });
}
