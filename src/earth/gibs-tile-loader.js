// LOT 24: GIBS tiles of the Living Earth page through the shared request runtime (one fetch per
// attempt, abortable, diagnostics) and decoded with createImageBitmap. Binary tiles are not kept
// in the persistent JSON/IndexedDB cache (NON_PERSISTENT_CACHE, as for the GLO-30 patches and the
// sky assets); the browser HTTP cache still applies (GIBS: Cache-Control max-age 3 days).
// Kept apart from gibs-tiles.js so the landing page (gateway preview) loads no new module.
import { createRequestRuntime } from '../core/runtime/request-runtime.js';
import { NON_PERSISTENT_CACHE } from '../core/sky/sky-assets.js';

let sharedRuntime = null;
let attemptSeq = 0; // a unique key per attempt: a retry never joins an attempt that is still being aborted

/** One runtime for the page's GIBS tiles (lazy). */
export function gibsTileRuntime() {
    if (!sharedRuntime) sharedRuntime = createRequestRuntime({ cache: NON_PERSISTENT_CACHE });
    return sharedRuntime;
}

/**
 * One attempt: a new fetch (retries: 0 — loadTileWithRetry in gibs-tiles.js owns the retries,
 * the timeout and the backoff) and a decode. Resolves with an ImageBitmap (drawn, then closed by
 * the mosaic). A decode failure is an error of this attempt with reason "decode".
 */
export async function loadGibsTileBitmap(url, { signal = null, runtime = gibsTileRuntime(), decode = (blob) => createImageBitmap(blob) } = {}) {
    const result = await runtime.fetchResource({
        key: `gibs-tile:${url}#${++attemptSeq}`,
        url,
        responseType: 'blob',
        ttl: 0,
        staleTtl: 0,
        timeout: 0, // the visible-time timeout of loadTileWithRetry aborts `signal`
        retries: 0,
        signal,
        fetchOptions: { mode: 'cors', priority: 'low' },
    });
    try {
        return await decode(result.data);
    } catch (error) {
        const decodeError = new Error(`GIBS tile could not be decoded: ${url} (${error?.message || error})`);
        decodeError.tileReason = 'decode';
        throw decodeError;
    }
}
