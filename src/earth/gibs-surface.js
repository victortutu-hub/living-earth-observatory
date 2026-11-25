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
//
// LOT 24 (no more "all or nothing"): the levels load independently (z3 never
// waits for z2), sharing one bounded request pool (z2 tiles first). Each tile
// goes through the request runtime (gibs-tile-loader.js): a new request per
// attempt, 20 s / 30 s / 45 s of visible time per attempt (2 retries with backoff). A tile
// that still fails is retried in the background every 10 s until 3 min after
// the start, with a longer attempt (45 s: a slow but alive source still
// answers); when its level completes, the surface moves up to it (from the
// bundled texture or from z2) without a reload. The best complete level is
// shown (z3 > z2 > bundled). One level never takes more than levelConcurrency
// of the shared requests, so z3 keeps loading while z2 tiles struggle.
// Everything stops on `signal`.
import { EARTH_TEMPORAL_LAYERS } from './temporal-provenance.js';
import { GIBS_LAYERS, GIBS_TILE_POLICY, attemptTimeoutMs, composeGibsEquirectangularMosaic, gibsGlobeCoverage, loadTileWithRetry, waitAbortable } from './gibs-tiles.js';
import { loadGibsTileBitmap } from './gibs-tile-loader.js';

export const BLUE_MARBLE_SURFACE_LAYER = GIBS_LAYERS.blueMarble;
export const SURFACE_LEVELS = Object.freeze([2, 3]);
/** Largest surface texture uploaded to the GPU; larger crops are resampled down. */
export const SURFACE_MAX_SIZE = Object.freeze({ width: 4096, height: 2048 });
export const SURFACE_TILE_POLICY = Object.freeze({
    concurrency: 8, // requests in flight for the whole surface (both levels)
    levelConcurrency: 6, // at most per level: the other level always keeps 2
    tileTimeoutMs: GIBS_TILE_POLICY.timeoutMs, // 20 s / 30 s / 45 s per attempt
    retries: 2,
    backoffMs: Object.freeze([1000, 3000]),
    backgroundRetryMs: 10_000,
    backgroundTimeoutMs: 45_000, // one attempt per background round
    deadlineMs: 180_000, // background loading stops 3 min after the start
});

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
                : event.retrying // LOT 24: tiles still retried in the background
                    ? 'Surface: bundled fallback texture active — NASA GIBS WMTS unavailable; retrying in the background'
                    : 'Surface: bundled fallback texture active — NASA GIBS WMTS unavailable',
        };
    default:
        throw new RangeError(`Unknown surface status event: ${event.kind}`);
    }
}

function outputSizeFor(width, height) {
    return width > SURFACE_MAX_SIZE.width ? { ...SURFACE_MAX_SIZE } : { width, height };
}

/** Width in px of the texture a level produces (z2 -> 2560, z3 -> 4096 after resampling). */
export function surfaceLevelWidth(z) {
    const crop = gibsGlobeCoverage(BLUE_MARBLE_SURFACE_LAYER.matrixSet, z);
    return outputSizeFor(crop.width, crop.height).width;
}

/**
 * LOT 41: the levels worth requesting over a texture `currentWidth` px wide of the same product. The bundled
 * Blue Marble NG is 4096 x 2048, so the z2 "preview" (2560 x 1280) only ever replaced a sharper image with a
 * blurrier one while z3 was loading; only levels at least as wide are kept (-> [3]).
 */
export function surfaceLevelsAbove(currentWidth, levels = SURFACE_LEVELS) {
    return levels.filter((z) => surfaceLevelWidth(z) >= currentWidth);
}

/** LOT 41: a level replaces the texture on screen only if it is at least as wide (never a downgrade). */
export function shouldApplySurfaceLevel(currentWidth, levelWidth) {
    return Number(levelWidth) >= (Number(currentWidth) || 0);
}

/**
 * A bounded pool of async jobs (LOT 24): a higher priority runs first, and a
 * group (one surface level) never holds more than groupLimit slots.
 */
export function createPriorityLimiter(limit, { groupLimit = limit } = {}) {
    let active = 0;
    const perGroup = new Map();
    const waiting = [];
    const next = () => {
        waiting.sort((a, b) => b.priority - a.priority);
        for (let i = 0; i < waiting.length && active < limit;) {
            const job = waiting[i];
            if ((perGroup.get(job.group) || 0) >= groupLimit) { i++; continue; }
            waiting.splice(i, 1);
            active++;
            perGroup.set(job.group, (perGroup.get(job.group) || 0) + 1);
            Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
                active--;
                perGroup.set(job.group, perGroup.get(job.group) - 1);
                next();
            });
        }
    };
    return {
        run(priority, run, group = null) {
            return new Promise((resolve, reject) => { waiting.push({ priority, run, group, resolve, reject }); next(); });
        },
        get active() { return active; },
    };
}

const REASONS = Object.freeze(['timeout', 'http', 'decode', 'abort', 'network']);
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function emptyLevelStats(z, tiles) {
    return { z, tiles, arrived: 0, requests: 0, retried: 0, failed: 0, reasons: Object.fromEntries(REASONS.map((r) => [r, 0])), state: 'loading', shownMs: null };
}

/** One console line per level (LOT 24): requested / arrived / retried / failed (reasons), time to display. */
export function describeSurfaceLevel(stats) {
    const reasons = REASONS.filter((r) => stats.reasons[r]).map((r) => `${r} ${stats.reasons[r]}`).join(', ') || 'none';
    const shown = stats.shownMs != null ? `shown after ${(stats.shownMs / 1000).toFixed(1)} s` : stats.state;
    return `[Earth] NASA GIBS Blue Marble z${stats.z}: ${stats.tiles} tiles requested, ${stats.arrived} arrived, ${stats.requests} requests (${stats.retried} retries), ${stats.failed} failing; failed attempts: ${reasons} — ${shown}`;
}

/**
 * Loads the surface levels independently. onLevel(texture, info) fires when a
 * level completes and is better than the one on screen (the caller swaps it
 * in). onUnavailable({ retrying }) fires once when no level is on screen and
 * every level has a tile that failed its attempts (the bundled texture stays;
 * loading continues in the background). onStats(stats[]) reports per-level
 * counters. Resolves with the best level shown once nothing better can come
 * (final level shown, or every other level settled / past the deadline);
 * rejects if no level could be shown.
 */
export async function loadBlueMarbleSurfaceTexture({
    THREE,
    renderer,
    levels = SURFACE_LEVELS,
    onLevel = null,
    onUnavailable = null,
    onStats = null,
    loadImage = loadGibsTileBitmap,
    createCanvas,
    signal = null,
    policy = SURFACE_TILE_POLICY,
    doc,
    log = (line) => console.info(line),
}) {
    const p = { ...SURFACE_TILE_POLICY, ...policy };
    const started = nowMs();
    const elapsed = () => nowMs() - started;
    const finalLevel = levels[levels.length - 1];
    const limiter = createPriorityLimiter(p.concurrency, { groupLimit: Math.min(p.concurrency, p.levelConcurrency ?? p.concurrency) });
    const controllers = new Map(levels.map((z) => [z, new AbortController()]));
    const stats = new Map(levels.map((z) => {
        const crop = gibsGlobeCoverage(BLUE_MARBLE_SURFACE_LAYER.matrixSet, z);
        return [z, emptyLevelStats(z, crop.columns * crop.rows)];
    }));
    const failing = new Map(levels.map((z) => [z, new Set()]));
    const failures = new Map();
    let shown = null;
    let unavailableSent = false;
    const report = () => onStats?.([...stats.values()].map((entry) => ({ ...entry, reasons: { ...entry.reasons } })));
    const onOuterAbort = () => controllers.forEach((controller) => controller.abort(signal.reason));
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    const deadline = p.deadlineMs > 0
        ? setTimeout(() => controllers.forEach((controller, z) => { if (shown !== z) controller.abort(new DOMException('surface deadline', 'AbortError')); }), p.deadlineMs)
        : null;

    function maybeUnavailable() {
        if (unavailableSent || shown !== null) return;
        if (![...failing.values()].every((set) => set.size > 0)) return;
        unavailableSent = true;
        onUnavailable?.({ retrying: p.deadlineMs > 0 });
    }

    // One tile of one level: attempts in the shared pool, then background rounds until the deadline.
    const tileLoader = (z, priority) => async (url, { signal: tileSignal, doc: tileDoc } = {}) => {
        const entry = stats.get(z);
        for (let round = 0; ; round++) {
            try {
                // Round 0: the regular attempts; background rounds: one longer attempt each.
                const attempt = round === 0
                    ? { timeoutMs: p.tileTimeoutMs, retries: p.retries, backoffMs: p.backoffMs }
                    : { timeoutMs: p.backgroundTimeoutMs ?? p.tileTimeoutMs, retries: 0, backoffMs: [] };
                const image = await limiter.run(priority, () => loadTileWithRetry(loadImage, url, {
                    ...attempt, signal: tileSignal, doc: tileDoc,
                    onAttempt: ({ attempt, ok, reason }) => {
                        entry.requests++;
                        if (attempt > 0 || round > 0) entry.retried++;
                        if (!ok && reason) entry.reasons[reason]++;
                        report();
                    },
                }), z);
                entry.arrived++;
                if (failing.get(z).delete(url)) entry.failed = failing.get(z).size;
                report();
                return image;
            } catch (error) {
                if (tileSignal?.aborted) throw error;
                failing.get(z).add(url);
                entry.failed = failing.get(z).size;
                if (!failures.has(z)) failures.set(z, error.message);
                report();
                maybeUnavailable();
                if (!(p.deadlineMs > 0) || elapsed() + p.backgroundRetryMs >= p.deadlineMs) throw error;
                await waitAbortable(p.backgroundRetryMs, tileSignal);
            }
        }
    };

    const levelPromises = levels.map(async (z, index) => {
        const entry = stats.get(z);
        const crop = gibsGlobeCoverage(BLUE_MARBLE_SURFACE_LAYER.matrixSet, z);
        try {
            const mosaic = await composeGibsEquirectangularMosaic({
                layer: BLUE_MARBLE_SURFACE_LAYER,
                z,
                // Every tile holds a queue slot of its own: the shared pool above bounds the requests.
                concurrency: entry.tiles,
                // Attempt timeouts live in tileLoader; this outer bound only has to outlast the deadline.
                tileTimeoutMs: Math.max(p.deadlineMs, Array.from({ length: p.retries + 1 }, (_, i) => attemptTimeoutMs(p.tileTimeoutMs, i)).reduce((a, b) => a + b, 0) + 10_000) + (p.backgroundTimeoutMs ?? 0) + 60_000,
                retries: 0,
                outputSize: outputSizeFor(crop.width, crop.height),
                loadImage: tileLoader(z, -index),
                ...(createCanvas ? { createCanvas } : {}),
                ...(doc !== undefined ? { doc } : {}),
                signal: controllers.get(z).signal,
            });
            entry.state = 'complete';
            if (shown !== null && shown >= z) {
                mosaic.canvas.width = 0; // a better level is already on screen
                mosaic.canvas.height = 0;
                return null;
            }
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
            shown = z;
            entry.shownMs = Math.round(elapsed());
            report();
            log?.(describeSurfaceLevel(entry));
            const info = { z, resolution, tiles: mosaic.tiles, elapsedMs: mosaic.elapsedMs, final: z === finalLevel };
            onLevel?.(texture, info);
            // Nothing below this level can improve the surface any more.
            levels.filter((other) => other < z).forEach((other) => controllers.get(other).abort(new DOMException('superseded', 'AbortError')));
            return { texture, ...info };
        } catch (error) {
            if (signal?.aborted) throw error;
            entry.state = shown !== null && shown > z ? 'superseded' : 'failed';
            if (entry.state === 'failed') {
                if (!failures.has(z)) failures.set(z, error?.name === 'AbortError' ? 'deadline reached' : error.message);
                log?.(describeSurfaceLevel(entry));
            }
            report();
            return null;
        }
    });

    try {
        const results = await Promise.all(levelPromises);
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        const best = results.filter(Boolean).sort((a, b) => b.z - a.z)[0] || null;
        const failureList = levels.filter((z) => stats.get(z).state === 'failed').map((z) => `z${z}: ${failures.get(z)}`);
        if (!best) throw new Error(`NASA GIBS Blue Marble WMTS unavailable — ${failureList.join('; ')}`);
        return { ...best, failures: failureList, stats: [...stats.values()] };
    } finally {
        if (deadline) clearTimeout(deadline);
        signal?.removeEventListener('abort', onOuterAbort);
        controllers.forEach((controller) => { if (!controller.signal.aborted) controller.abort(new DOMException('surface load finished', 'AbortError')); });
    }
}
