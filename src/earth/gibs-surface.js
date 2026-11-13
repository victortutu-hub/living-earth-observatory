// NASA GIBS Blue Marble: Next Generation — a single, seamless, non-temporal
// global surface composite, loaded from WMTS tiles (LOT 4b-A). The daily VIIRS
// true-colour product in cloud-system.js is stitched from orbital swaths and
// shows seams when tiled; Blue Marble is one composite, so its tiles join
// without seams. WMTS answers in ~0.3-0.7 s per tile while the GIBS WMS
// (wms.cgi) took 45-160 s or returned 504 (measured 2026-11-12), so WMS is no
// longer used here.
//
// Next Generation, not "Shaded Relief and Bathymetry": the shaded variant has
// a fixed-direction hillshade baked into the pixels. Relief shading here comes
// only from the ETOPO normals lit by the real Sun (earth-material.js), so the
// albedo must be flat.
//
// Progressive: z2 (5 x 3 tiles, 2560 x 1280) is applied first, then z3
// (10 x 5 tiles, 5120 x 2560) resampled to 4096 x 2048 replaces it. The local
// bundled texture stays in place until a level succeeds, and remains the
// fallback if every level fails.
import { EARTH_TEMPORAL_LAYERS } from './temporal-provenance.js';
import { GIBS_LAYERS, composeGibsEquirectangularMosaic, gibsGlobeCoverage } from './gibs-tiles.js';

export const BLUE_MARBLE_SURFACE_LAYER = GIBS_LAYERS.blueMarble;
export const SURFACE_LEVELS = Object.freeze([2, 3]);
/** Largest surface texture uploaded to the GPU; larger crops are resampled down. */
export const SURFACE_MAX_SIZE = Object.freeze({ width: 4096, height: 2048 });
export const SURFACE_TILE_POLICY = Object.freeze({ concurrency: 8, tileTimeoutMs: 15_000, retries: 1 });

/**
 * #surfaceStatus text for each lifecycle event. "static reference active"
 * marks a settled NASA surface; fallback texts name the bundled texture.
 */
export function surfaceStatus(event) {
    switch (event.kind) {
    case 'preview':
        return { state: 'nasa', message: `Surface: NASA GIBS / Blue Marble NG — WMTS z${event.z} preview active (${event.resolution}); refining` };
    case 'settled':
        return {
            state: 'nasa',
            message: event.z === event.finalLevel
                ? `Surface: NASA GIBS / Blue Marble static reference active (WMTS z${event.z} → ${event.resolution})`
                : event.retryWhenVisible
                    ? `Surface: NASA GIBS / Blue Marble static reference active (WMTS z${event.z}, ${event.resolution}; z${event.finalLevel} did not finish while the page was hidden — retrying when visible)`
                    : `Surface: NASA GIBS / Blue Marble static reference active (WMTS z${event.z}, ${event.resolution}; z${event.finalLevel} unavailable)`,
        };
    case 'still-loading':
        return { state: 'fallback', message: 'Surface: bundled fallback texture active — NASA GIBS WMTS tiles still loading' };
    case 'unavailable':
        return {
            state: 'fallback',
            message: event.retryWhenVisible
                ? 'Surface: bundled fallback texture active — NASA GIBS WMTS tiles did not finish while the page was hidden; retrying when visible'
                : 'Surface: bundled fallback texture active — NASA GIBS WMTS unavailable',
        };
    default:
        throw new RangeError(`Unknown surface status event: ${event.kind}`);
    }
}

function outputSizeFor(width, height) {
    return width > SURFACE_MAX_SIZE.width ? { ...SURFACE_MAX_SIZE } : { width, height };
}

/**
 * Loads the surface level by level. onLevel(texture, info) fires for every
 * level that succeeds (the caller swaps it in and disposes the previous one).
 * Resolves with the last successful level; rejects only if every level fails.
 */
export async function loadBlueMarbleSurfaceTexture({
    THREE,
    renderer,
    levels = SURFACE_LEVELS,
    onLevel = null,
    loadImage,
    createCanvas,
    signal = null,
    policy = SURFACE_TILE_POLICY,
}) {
    const failures = [];
    let last = null;
    for (const z of levels) {
        try {
            const crop = gibsGlobeCoverage(BLUE_MARBLE_SURFACE_LAYER.matrixSet, z);
            const mosaic = await composeGibsEquirectangularMosaic({
                layer: BLUE_MARBLE_SURFACE_LAYER,
                z,
                concurrency: policy.concurrency,
                tileTimeoutMs: policy.tileTimeoutMs,
                retries: policy.retries,
                outputSize: outputSizeFor(crop.width, crop.height),
                ...(loadImage ? { loadImage } : {}),
                ...(createCanvas ? { createCanvas } : {}),
                signal,
            });
            const texture = new THREE.CanvasTexture(mosaic.canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            texture.needsUpdate = true;
            const resolution = `${mosaic.width}x${mosaic.height}`;
            texture.userData.surfaceResolution = resolution;
            texture.userData.surfaceSource = `NASA GIBS WMTS / Blue Marble Next Generation (no baked relief), z${z}, ${mosaic.tiles} tiles`;
            texture.userData.gibsLevel = z;
            texture.userData.gibsTiles = mosaic.tiles;
            texture.userData.gibsElapsedMs = mosaic.elapsedMs;
            texture.userData.temporal = EARTH_TEMPORAL_LAYERS.blueMarble;
            last = { texture, z, resolution, tiles: mosaic.tiles, elapsedMs: mosaic.elapsedMs };
            onLevel?.(texture, { z, resolution, tiles: mosaic.tiles, elapsedMs: mosaic.elapsedMs, final: z === levels[levels.length - 1] });
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            failures.push(`z${z}: ${error.message}`);
        }
    }
    if (!last) throw new Error(`NASA GIBS Blue Marble WMTS unavailable — ${failures.join('; ')}`);
    return { ...last, failures };
}
