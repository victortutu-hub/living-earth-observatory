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

    async function loadImage(url) {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.decoding = 'async';
        image.src = url;
        await image.decode();
        return image;
    }

    function buildCloudMaskTexture(image) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = frame.data;
        let alphaSum = 0;
        const columnAlpha = new Float32Array(canvas.width);
        for (let i = 0; i < data.length; i += 4) {
            const pixel = i / 4;
            const x = pixel % canvas.width;
            const y = Math.floor(pixel / canvas.width);
            const lat = 90 - (y / (canvas.height - 1)) * 180;
            const polarFade = THREE.MathUtils.smoothstep(78 - Math.abs(lat), 0, 18);
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
            data[i] = 238;
            data[i + 1] = 246;
            data[i + 2] = 255;
            data[i + 3] = alpha;
        }

        const coverage = alphaSum / (255 * canvas.width * canvas.height);
        let maxColumnJump = 0;
        let strongColumnJumps = 0;
        for (let x = 1; x < canvas.width; x++) {
            const prev = columnAlpha[x - 1] / canvas.height;
            const current = columnAlpha[x] / canvas.height;
            const jump = Math.abs(current - prev);
            maxColumnJump = Math.max(maxColumnJump, jump);
            if (jump > 0.08) strongColumnJumps++;
        }
        if (coverage < 0.012 || coverage > 0.32) {
            throw new Error(`cloud mask coverage out of range (${coverage.toFixed(3)})`);
        }
        if (maxColumnJump > 0.18 || strongColumnJumps > 12) {
            throw new Error(`cloud layer has visible satellite swath seams (${maxColumnJump.toFixed(3)})`);
        }

        ctx.putImageData(frame, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        texture.needsUpdate = true;
        return texture;
    }

    async function enable() {
        updateButton(true);
        const errors = [];
        for (let daysAgo = 1; daysAgo <= 8; daysAgo++) {
            const date = isoDateDaysAgo(daysAgo);
            try {
                let texture = realCloudCache.get(date);
                if (!texture) {
                    const image = await loadImage(gibsTrueColorUrl(date));
                    texture = buildCloudMaskTexture(image);
                    realCloudCache.set(date, texture);
                }

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
                state.cloudSourceMessage = `Clouds: NASA GIBS latest complete snapshot ${date}`;
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
