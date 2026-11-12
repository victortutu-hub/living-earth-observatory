// NASA GIBS Black Marble is an observed annual nighttime-light composite.
// Loaded from WMTS tiles (LOT 4b-A): level z2 of the 500m set, 5 x 3 tiles
// cropped to 360 x 180 (2560 x 1280). It is a single seamless composite, so
// the tiles join without seams; WMS (wms.cgi) is no longer used because it
// answered in 45-160 s or 504 (measured 2026-11-12). The local texture
// remains the startup/failure fallback.
import { EARTH_TEMPORAL_LAYERS } from './temporal-provenance.js';
import { GIBS_LAYERS, composeGibsEquirectangularMosaic } from './gibs-tiles.js';

export const BLACK_MARBLE_LEVEL = 2;
export const BLACK_MARBLE_TILE_POLICY = Object.freeze({ concurrency: 8, tileTimeoutMs: 15_000, retries: 1 });

export async function loadBlackMarbleTexture({
    THREE,
    renderer,
    year = 2016,
    z = BLACK_MARBLE_LEVEL,
    loadImage,
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
        ...(loadImage ? { loadImage } : {}),
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
