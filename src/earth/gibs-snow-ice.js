// NASA GIBS MODIS Terra NDSI Snow Cover — a real, observed daily mask, unlike
// Blue Marble/Black Marble which are non-temporal composites. Since LOT 5 it
// comes from WMTS tiles (gibs-tiles.js) with the date in the tile URL, level
// z2 of the 500m set (5 x 3 tiles, 2560 x 1280), composed on a transparent
// canvas. The GIBS WMS answered in 2–160 s; one z2 tile takes ~0.3–0.6 s.
import { GIBS_LAYERS, composeGibsEquirectangularMosaic } from './gibs-tiles.js';
import { createTemporalDescriptor, EARTH_TEMPORAL_LAYERS, utcDay } from './temporal-provenance.js';

const DAY_MS = 86_400_000;
export const SNOW_ICE_ZOOM = 2;

// Live only: MODIS Terra NRT swaths can lag a day or two before the daily
// mosaic is complete, so Live walks back a few days (today's behaviour). A
// historical day is requested exactly; it is never replaced by a neighbour.
const LIVE_LOOKBACK_DAYS = [1, 2, 3];

export function snowIceLiveCandidates(now = Date.now()) {
    return LIVE_LOOKBACK_DAYS.map((daysAgo) => utcDay(now - daysAgo * DAY_MS));
}

function abortError(signal) {
    return signal?.reason || new DOMException('Aborted', 'AbortError');
}

/**
 * Resolves to a THREE.CanvasTexture of the snow mask for `day` (YYYY-MM-DD),
 * or for the latest available day when `day` is null (Live).
 */
export async function loadSnowIceMaskTexture({
    THREE,
    day = null,
    z = SNOW_ICE_ZOOM,
    signal = null,
    tileTimeoutMs = 15_000,
    compose = composeGibsEquirectangularMosaic,
    now = Date.now(),
}) {
    const candidates = day ? [day] : snowIceLiveCandidates(now);
    const errors = [];
    for (const date of candidates) {
        if (signal?.aborted) throw abortError(signal);
        try {
            const mosaic = await compose({ layer: GIBS_LAYERS.snowCover, date, z, alpha: true, signal, tileTimeoutMs });
            if (signal?.aborted) {
                mosaic.canvas.width = 0;
                throw abortError(signal);
            }
            const texture = new THREE.CanvasTexture(mosaic.canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            texture.needsUpdate = true;
            texture.userData.snowIceDate = date;
            texture.userData.mosaic = { z: mosaic.z, tiles: mosaic.tiles, width: mosaic.width, height: mosaic.height, elapsedMs: mosaic.elapsedMs };
            texture.userData.temporal = createTemporalDescriptor({ ...EARTH_TEMPORAL_LAYERS.snowIce, sourceTime: `${date}T00:00:00Z`, loadedAt: new Date(), cacheState: 'unknown' });
            return texture;
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            errors.push(`${date}: ${error.message}`);
        }
    }
    throw new Error(`NASA GIBS MODIS Terra NDSI Snow Cover unavailable — ${errors.join('; ')}`);
}

/** Frees a mask texture and its canvas (GPU and CPU copies). */
export function disposeSnowIceTexture(texture) {
    if (!texture) return;
    texture.dispose?.();
    const image = texture.image;
    if (image && 'width' in image) {
        image.width = 0;
        image.height = 0;
    }
}
