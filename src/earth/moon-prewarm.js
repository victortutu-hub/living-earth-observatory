// LOT 32: the Moon's first render used to stall one frame for 230 to 290 ms. That frame decoded three JPEGs on the
// main thread (LROC colour 4K, LOLA normal 4K, LDEM 1K, together about 130 ms) and linked the Moon shader
// (about 46 ms). The stall came whenever the Moon first entered the view, which depends on the date and the
// camera.
// Two changes, with no visual change:
//   1. loadTextureBitmapFirst: fetch + createImageBitmap through THREE.ImageBitmapLoader decodes off the main
//      thread. The bitmap options reproduce what WebGL did with the <img>: flipY, no premultiplication, and colour
//      conversion only for colour textures. If that fails, it falls back to the previous THREE.TextureLoader
//      path, and the caller's onError (the LROC 1K fallback) runs only if both fail.
//   2. createMoonPrewarm: after the page `load` event, it uploads the textures in idle time
//      (renderer.initTexture), one per idle slot, then compiles the Moon program with renderer.compileAsync
//      (parallel shader compile). It compiles with the composer's render target bound, so that the program
//      matches the one RenderPass uses. It never runs work synchronously in start(), it can be cancelled, and
//      a failure only logs: the Moon then loads on first view, as before.

/**
 * LOT 32: should the Moon be uploaded to the GPU in advance? The warm-up keeps about 90 MB of Moon textures
 * on the GPU even if the Moon is never seen, so it runs only when the device can afford it:
 * - navigator.deviceMemory >= 4 GB: warm up;
 * - deviceMemory below 4 GB: no warm-up;
 * - deviceMemory not reported (e.g. Firefox, Safari): warm up only in the desktop layout
 *   (innerWidth > mobileMaxPx, the same 760 px as the layout checks).
 * Without the warm-up the Moon uploads on its first view, as before; decoding still happens off the main thread.
 */
// The mobile-layout width of the page (= MOBILE_LAYOUT_MAX_PX of src/earth/perf/earth-layout-checks.js, which
// non-perf code must not import statically; a test keeps the two equal).
export const MOON_PREWARM_MOBILE_MAX_PX = 760;

export function moonPrewarmDecision({ deviceMemory, innerWidth, mobileMaxPx = MOON_PREWARM_MOBILE_MAX_PX }) {
    if (Number.isFinite(deviceMemory)) {
        return deviceMemory >= 4
            ? { warm: true, reason: `deviceMemory ${deviceMemory} GB` }
            : { warm: false, reason: `deviceMemory ${deviceMemory} GB (< 4 GB)` };
    }
    const mobileLayout = Number.isFinite(innerWidth) && innerWidth <= mobileMaxPx;
    return mobileLayout
        ? { warm: false, reason: 'deviceMemory not reported, mobile layout' }
        : { warm: true, reason: 'deviceMemory not reported, desktop layout' };
}

/** LOT 32: the single console line when the warm-up is skipped (no change to the Moon details). */
export function moonPrewarmSkippedMessage(reason) {
    return `[Moon] GPU warm-up skipped (${reason}): the Moon textures upload on its first view; decoding stays off the main thread.`;
}

/** LOT 32: createImageBitmap options equivalent to the WebGL unpack state THREE uses for an <img>. */
export function moonBitmapOptions({ colorTexture }) {
    return { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: colorTexture ? 'default' : 'none' };
}

/**
 * LOT 32: one texture, decoded off the main thread when possible.
 * Returns { texture, ready }. `ready` resolves true once an image is in place and false if both paths failed.
 * `isActive()` false (the owner was stopped) drops a late result.
 */
export function loadTextureBitmapFirst({ THREE, file, colorSpace, anisotropy = 4, onLoad = () => {}, onError = () => {}, isActive = () => true, hasCreateImageBitmap = typeof globalThis.createImageBitmap === 'function' }) {
    const texture = new THREE.Texture();
    texture.colorSpace = colorSpace;
    texture.anisotropy = anisotropy;
    texture.userData.decode = { path: 'pending', reason: null };
    let settle;
    const ready = new Promise((resolve) => { settle = resolve; });
    const viaImage = (reason) => {
        texture.userData.decode = { path: 'image', reason };
        new THREE.TextureLoader().load(file, (loaded) => {
            if (!isActive()) return settle(false);
            texture.image = loaded.image;
            texture.flipY = true;
            texture.needsUpdate = true;
            onLoad(texture);
            settle(true);
        }, undefined, (error) => {
            if (isActive()) onError(error);
            settle(false);
        });
    };
    if (!hasCreateImageBitmap || typeof THREE.ImageBitmapLoader !== 'function') {
        viaImage('createImageBitmap unavailable');
        return { texture, ready };
    }
    const loader = new THREE.ImageBitmapLoader();
    loader.setOptions(moonBitmapOptions({ colorTexture: colorSpace !== THREE.NoColorSpace }));
    loader.load(file, (bitmap) => {
        if (!isActive()) { bitmap?.close?.(); return settle(false); }
        texture.image = bitmap;
        texture.flipY = false; // already flipped by imageOrientation; WebGL ignores UNPACK_FLIP_Y for bitmaps
        texture.needsUpdate = true;
        texture.userData.decode = { path: 'image-bitmap', reason: null };
        onLoad(texture);
        settle(true);
    }, undefined, (error) => {
        if (!isActive()) return settle(false);
        viaImage(`image bitmap failed: ${error?.message || error}`);
    });
    return { texture, ready };
}

function defaultScheduleIdle(task) {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        const handle = window.requestIdleCallback(task, { timeout: 2000 });
        return () => window.cancelIdleCallback?.(handle);
    }
    const handle = setTimeout(task, 200);
    return () => clearTimeout(handle);
}

function defaultWhenLoaded(register) {
    if (typeof document === 'undefined' || document.readyState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
        const onLoad = () => resolve();
        window.addEventListener('load', onLoad, { once: true });
        register(() => window.removeEventListener('load', onLoad));
    });
}

/**
 * LOT 32: GPU warm-up of the Moon at idle time.
 * getTextures() is read when the warm-up runs, so a fallback swap made before then is honoured.
 * objects: the meshes to compile.
 * getRenderTarget(): the target RenderPass draws into, or null.
 */
export function createMoonPrewarm({ renderer, scene, camera, objects, getTextures, ready, getRenderTarget = () => null, scheduleIdle = defaultScheduleIdle, whenLoaded = defaultWhenLoaded, warn = (...a) => console.warn(...a), now = () => performance.now() }) {
    let cancelled = false;
    let started = false;
    const cleanups = new Set();
    const status = { state: 'idle', textures: 0, compiled: false, error: null, startedAt: null, finishedAt: null };
    const idle = () => new Promise((resolve) => {
        let cancel = null;
        const done = () => { cleanups.delete(cancel); resolve(); };
        cancel = scheduleIdle(done);
        cleanups.add(cancel);
    });

    async function run() {
        status.state = 'waiting';
        await Promise.all([ready, whenLoaded((cleanup) => cleanups.add(cleanup))]);
        if (cancelled) return;
        status.state = 'warming';
        status.startedAt = now();
        const seen = new Set();
        for (const texture of getTextures()) {
            if (!texture || seen.has(texture) || !texture.image) continue;
            seen.add(texture);
            await idle();
            if (cancelled) return;
            renderer.initTexture(texture);
            status.textures += 1;
        }
        await idle();
        if (cancelled) return;
        if (typeof renderer.compileAsync === 'function') {
            const previous = renderer.getRenderTarget();
            const target = getRenderTarget();
            const pending = [];
            try {
                if (target) renderer.setRenderTarget(target);
                // compileAsync() creates the programs synchronously, then waits for the parallel compile to finish.
                for (const object of objects) pending.push(renderer.compileAsync(object, camera, scene));
            } finally {
                renderer.setRenderTarget(previous);
            }
            await Promise.all(pending);
            if (cancelled) return;
            status.compiled = true;
        }
        status.state = 'done';
        status.finishedAt = now();
    }

    function start() {
        if (started || cancelled) return;
        started = true;
        run().catch((error) => {
            if (cancelled) return;
            status.state = 'failed';
            status.error = String(error?.message || error);
            warn('[Moon] GPU warm-up failed; the Moon loads on its first view, as before.', error);
        });
    }

    function cancel() {
        cancelled = true;
        for (const cleanup of cleanups) cleanup?.();
        cleanups.clear();
        if (status.state !== 'done' && status.state !== 'failed') status.state = 'cancelled';
    }

    return { start, cancel, status };
}
