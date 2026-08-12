import { GIBS_LAYERS, composeGibsEquirectangularMosaic } from './gibs-tiles.js?v=seamGate2';

const GIBS_FIXED_ZOOM = 1;
// VIIRS true-colour tiles can contain acquisition swaths with hard data
// boundaries.  A canvas mosaic removes geometry seams but cannot invent the
// missing observations between those swaths, so it is not safe to display as
// a cloud layer yet.  Keep the compositor for the later true-colour surface
// path; Daily clouds uses the NASA-rendered global mosaic until then.
const USE_TILED_VIIRS_CLOUD_MOSAIC = false;
// The daily VIIRS product is temporarily paused in the public control. Even
// the global WMS true-colour composite has observational swath/coverage
// changes that are too easy to misread as a broken cloud layer. The stable
// procedural cloud layer remains active underneath; this avoids shipping a
// visually misleading "live" snapshot while the correct cloud product is
// selected and validated separately.
const DAILY_CLOUDS_ENABLED = false;

export function createCloudSystem({
    THREE,
    renderer,
    state,
    cloudOverlayMat,
    realCloudOverlay,
    fallbackTexture,
    startCloudOverlayCrossfade,
    applyNightLook,
    buttonId = 'realCloudBtn',
    statusId = 'cloudSourceStatus'
}) {
    let realCloudTexture = null;
    const realCloudCache = new Map();

    function updateButton(loading = false) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        if (!DAILY_CLOUDS_ENABLED) {
            btn.disabled = true;
            btn.textContent = 'Daily clouds: temporarily paused';
            btn.title = 'NASA GIBS daily VIIRS cloud display is paused while its global coverage is validated.';
            state.cloudSourceState = 'paused';
            state.cloudSourceMessage = 'Clouds: NASA GIBS daily snapshot temporarily paused; stable procedural layer active';
            const status = document.getElementById(statusId);
            if (status) {
                status.dataset.state = state.cloudSourceState;
                status.textContent = state.cloudSourceMessage;
            }
            return;
        }
        btn.disabled = false;
        if (loading) {
            btn.textContent = 'Daily clouds: loading';
            state.cloudSourceState = 'loading';
            state.cloudSourceMessage = 'Clouds: checking latest complete NASA GIBS snapshots';
        } else {
            btn.textContent = state.realClouds ? `Daily clouds: ${state.realCloudDate || 'on'}` : 'Daily clouds: off';
        }
        const status = document.getElementById(statusId);
        if (status) {
            status.dataset.state = state.cloudSourceState;
            status.textContent = state.cloudSourceMessage;
        }
    }

    function gibsTrueColorUrl(date) {
        const params = new URLSearchParams({
            SERVICE: 'WMS',
            REQUEST: 'GetMap',
            VERSION: '1.3.0',
            LAYERS: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
            STYLES: '',
            FORMAT: 'image/jpeg',
            TRANSPARENT: 'false',
            HEIGHT: '512',
            WIDTH: '1024',
            CRS: 'EPSG:4326',
            BBOX: '-90,-180,90,180',
            TIME: date
        });
        return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
    }

    function isoDateDaysAgo(daysAgo) {
        const date = new Date(Date.now() - daysAgo * 86400000);
        return date.toISOString().slice(0, 10);
    }

    async function loadImage(url, timeoutMs = 12000) {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.src = url;
        let timeoutId;
        try {
            await Promise.race([
                image.decode(),
                new Promise((_, reject) => {
                    timeoutId = window.setTimeout(() => reject(new Error(`image decode timed out after ${timeoutMs}ms`)), timeoutMs);
                })
            ]);
        } finally {
            window.clearTimeout(timeoutId);
        }
        return image;
    }

    function buildCloudMaskTexture(image, { enforceSeamGate = false } = {}) {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        if (!canvas.width || !canvas.height) throw new Error('NASA GIBS returned an empty cloud image.');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = frame.data;
        let alphaSum = 0;
        const columnAlpha = new Float32Array(canvas.width);
        const rowAlpha = new Float32Array(canvas.height);
        for (let i = 0; i < data.length; i += 4) {
            const pixel = i / 4;
            const x = pixel % canvas.width;
            const y = Math.floor(pixel / canvas.width);
            const lat = 90 - (y / (canvas.height - 1)) * 180;
            // Do not erase legitimate polar cloud systems.  The previous
            // anti-ice heuristic began fading near 60 degrees latitude and
            // made Antarctica look like the raster had been cut away.  Keep
            // full coverage through 82 degrees and only soften the final
            // few pixels at each pole, where snow/ice is indistinguishable
            // from cloud in true-colour imagery.
            const polarFade = 1 - THREE.MathUtils.smoothstep(Math.abs(lat), 82, 90);
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturation = max - min;
            const bright = (r + g + b) / 3;
            const cloudScore = THREE.MathUtils.clamp((bright - 146) / 86, 0, 1) * THREE.MathUtils.clamp((92 - saturation) / 72, 0, 1) * polarFade;
            const alpha = cloudScore > 0.16 ? Math.round(Math.pow(cloudScore, 1.55) * 165) : 0;
            alphaSum += alpha;
            columnAlpha[x] += alpha / 255;
            rowAlpha[y] += alpha / 255;
            data[i] = 238;
            data[i + 1] = 246;
            data[i + 2] = 255;
            data[i + 3] = alpha;
        }

        const coverage = alphaSum / (255 * canvas.width * canvas.height);
        let maxColumnJump = 0;
        let strongColumnJumps = 0;
        let maxRowJump = 0;
        let strongRowJumps = 0;
        for (let x = 1; x < canvas.width; x++) {
            const prev = columnAlpha[x - 1] / canvas.height;
            const current = columnAlpha[x] / canvas.height;
            const jump = Math.abs(current - prev);
            maxColumnJump = Math.max(maxColumnJump, jump);
            if (jump > 0.08) strongColumnJumps++;
        }
        for (let y = 1; y < canvas.height; y++) {
            const prev = rowAlpha[y - 1] / canvas.width;
            const current = rowAlpha[y] / canvas.width;
            const jump = Math.abs(current - prev);
            maxRowJump = Math.max(maxRowJump, jump);
            if (jump > 0.08) strongRowJumps++;
        }
        // The single global fallback can legitimately retain more bright
        // high-latitude coverage than the per-tile source; only the tile
        // candidate uses the stricter rejection ceiling.
        const maxCoverage = enforceSeamGate ? 0.32 : 0.42;
        if (coverage < 0.012 || coverage > maxCoverage) {
            throw new Error(`cloud mask coverage out of range (${coverage.toFixed(3)})`);
        }
        if (enforceSeamGate && (maxColumnJump > 0.18 || strongColumnJumps > 12 || maxRowJump > 0.18 || strongRowJumps > 12)) {
            throw new Error(`cloud tile mosaic has visible swath seams (x=${maxColumnJump.toFixed(3)}, y=${maxRowJump.toFixed(3)})`);
        }

        ctx.putImageData(frame, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        texture.needsUpdate = true;
        return texture;
    }

    // The daily GIBS product is true-colour imagery, not a cloud mask.  Using
    // a brightness threshold made clear ocean and polar regions transparent,
    // which looked like missing pieces of the Earth.  Keep the full raster and
    // let the overlay shader fade it into the base surface on the night side.
    function buildTrueColorTexture(image) {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        if (!canvas.width || !canvas.height) throw new Error('NASA GIBS returned an empty true-colour image.');
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        texture.needsUpdate = true;
        return texture;
    }

    async function loadSeamSafeCloudTexture(date) {
        if (!USE_TILED_VIIRS_CLOUD_MOSAIC) {
            const image = await loadImage(gibsTrueColorUrl(date));
            return { texture: buildTrueColorTexture(image), source: 'wms-global-true-color' };
        }
        try {
            const mosaic = await composeGibsEquirectangularMosaic({
                layer: GIBS_LAYERS.dailyClouds,
                date,
                z: GIBS_FIXED_ZOOM,
                loadImage,
                concurrency: 8
            });
            return { texture: buildCloudMaskTexture(mosaic.canvas, { enforceSeamGate: true }), source: 'tiled' };
        } catch (err) {
            console.warn('GIBS tile mosaic rejected by the seam gate; using the single-raster WMS fallback.', err);
            const image = await loadImage(gibsTrueColorUrl(date));
            return { texture: buildCloudMaskTexture(image), source: 'wms-seam-gate' };
        }
    }

    async function enable() {
        if (!DAILY_CLOUDS_ENABLED) {
            disable();
            return;
        }
        updateButton(true);
        const errors = [];
        for (let daysAgo = 1; daysAgo <= 8; daysAgo++) {
            const date = isoDateDaysAgo(daysAgo);
            try {
                let texture = realCloudCache.get(date);
                if (!texture) {
                    const loaded = await loadSeamSafeCloudTexture(date);
                    texture = loaded.texture;
                    texture.userData.gibsTransport = loaded.source;
                    realCloudCache.set(date, texture);
                }

                // The full true-colour raster supplies cloud coverage without
                // creating binary holes.  No procedural drift/morph is applied
                // to observed imagery, and it vanishes on the night side so
                // Black Marble stays visible.
                cloudOverlayMat.uniforms.uOpacity.value = 0.38;
                // Observed imagery must remain faintly legible beyond the
                // terminator.  Zero made the globe look like a half-loaded
                // texture; this low value preserves Black Marble while still
                // revealing the continuous daily raster.
                cloudOverlayMat.uniforms.uCloudNight.value = 0.32;
                cloudOverlayMat.uniforms.uCloudTwilight.value = 0.12;
                cloudOverlayMat.uniforms.uDriftScale.value = 0;
                cloudOverlayMat.uniforms.uMorphScale.value = 0;

                if (state.realClouds && realCloudTexture) {
                    startCloudOverlayCrossfade(texture);
                    realCloudTexture = texture;
                } else {
                    realCloudTexture = texture;
                    cloudOverlayMat.uniforms.uMap.value = realCloudTexture;
                    realCloudOverlay.visible = true;
                    state.realClouds = true;
                }

                state.realCloudDate = date;
                state.cloudSourceState = 'nasa';
                const transport = texture.userData.gibsTransport === 'tiled'
                    ? `NASA GIBS / VIIRS seamless tiled composite ${date} (z=${GIBS_FIXED_ZOOM})`
                    : `NASA GIBS / VIIRS true-color global composite ${date}`;
                state.cloudSourceMessage = `Clouds: ${transport}`;
                applyNightLook(state.night);
                updateButton();
                return;
            } catch (err) {
                errors.push(`${date}: ${err.message}`);
            }
        }

        state.realClouds = false;
        state.realCloudDate = null;
        realCloudOverlay.visible = false;
        cloudOverlayMat.uniforms.uOpacity.value = 0;
        state.cloudSourceState = 'error';
        state.cloudSourceMessage = 'Clouds: NASA GIBS unavailable; using artistic fallback';
        applyNightLook(state.night);
        updateButton();
        console.warn('NASA GIBS cloud layer could not be loaded. Keeping artistic fallback.', errors.slice(0, 3));
    }

    function disable() {
        state.realClouds = false;
        state.realCloudDate = null;
        realCloudOverlay.visible = false;
        cloudOverlayMat.uniforms.uMap.value = fallbackTexture;
        cloudOverlayMat.uniforms.uOpacity.value = 0;
        cloudOverlayMat.uniforms.uCloudNight.value = 0.46;
        cloudOverlayMat.uniforms.uCloudTwilight.value = 0.24;
        cloudOverlayMat.uniforms.uDriftScale.value = 0.22;
        cloudOverlayMat.uniforms.uMorphScale.value = 0.03;
        state.cloudSourceState = 'artistic';
        state.cloudSourceMessage = 'Clouds: artistic procedural layer';
        applyNightLook(state.night);
        updateButton();
    }

    return {
        enable,
        disable,
        updateButton
    };
}
