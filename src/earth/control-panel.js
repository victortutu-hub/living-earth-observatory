export function createControlPanel({ state }) {
    const byId = id => document.getElementById(id);
    let keydownHandler = null;
    let disposed = false;

    function formatClock(timestamp) {
        if (!timestamp) return '--:--';
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function updateCaptureMode() {
        document.body.classList.toggle('capture-mode', state.captureMode);
        byId('captureBtn').textContent = `Capture: ${state.captureMode ? 'on' : 'off'}`;
    }

    function updateGuide916() {
        document.body.classList.toggle('guide-916', state.guide916);
        byId('guide916Btn').textContent = `Guide 9:16: ${state.guide916 ? 'on' : 'off'}`;
        const viewportWidth = innerWidth;
        const viewportHeight = innerHeight;
        const targetRatio = 9 / 16;
        let guideWidth = viewportHeight * targetRatio;
        let guideHeight = viewportHeight;
        if (guideWidth > viewportWidth) {
            guideWidth = viewportWidth;
            guideHeight = viewportWidth / targetRatio;
        }
        document.documentElement.style.setProperty('--guide-width', `${Math.round(guideWidth)}px`);
        document.documentElement.style.setProperty('--guide-height', `${Math.round(guideHeight)}px`);
    }

    function updateVerticalDirectorUi() {
        const button = byId('verticalDirectorBtn');
        if (button) button.textContent = `Vertical director: ${state.verticalDirector ? 'on' : 'off'}`;
        document.body.classList.toggle('vertical-director', Boolean(state.verticalDirector));
    }

    function updateReelDurationUi() {
        const slider = byId('reelDuration');
        const value = byId('reelDurationValue');
        if (slider) slider.value = String(state.reelDurationSec);
        if (value) value.textContent = `${state.reelDurationSec}s`;
    }

    function updateSpinUi() {
        const spin = byId('spinSpeed');
        const spinVal = byId('spinSpeedValue');
        const snap = byId('snapDuration');
        const snapVal = byId('snapDurationValue');
        if (spin) spin.value = String(state.spinFast);
        if (spinVal) spinVal.textContent = state.spinFast.toFixed(1);
        if (snap) snap.value = String(state.snapDuration);
        if (snapVal) snapVal.textContent = `${state.snapDuration.toFixed(2)}s`;
    }

    function updateBrandPreset() {
        byId('brandPresetBtn').textContent = `Brand: ${state.brandPreset ? 'on' : 'off'}`;
    }

    function updateReelMoodUi() {
        const select = byId('reelMood');
        if (select) select.value = state.reelMood;
    }

    function updateMotionPresetUi() {
        const select = byId('motionPreset');
        if (select) select.value = state.motionPreset;
    }

    function updateSocialPresetUi() {
        const select = byId('socialPreset');
        if (select) select.value = state.socialPreset || 'custom';
    }

    function updateCaptionUi() {
        const select = byId('captionStyle');
        const button = byId('poeticCaptionBtn');
        if (select) select.value = state.captionStyle || 'cinematic';
        if (button) button.textContent = `Poetic line: ${state.poeticCaptions ? 'on' : 'off'}`;
    }

    function updateDataRhythmUi() {
        const button = byId('dataRhythmBtn');
        if (button) button.textContent = `Data rhythm: ${state.dataRhythm ? 'on' : 'off'}`;
    }

    function updateEonetRefreshStatus({ enabled = false, running = false, lastRefresh = null, lastError = null, nextRefresh = null } = {}) {
        const button = byId('autoRefreshBtn');
        const status = byId('eonetRefreshStatus');
        if (button) button.textContent = `Auto refresh: ${enabled ? 'on' : 'off'}`;
        if (!status) return;
        status.dataset.state = running ? 'refreshing' : enabled ? 'on' : 'off';
        if (running) {
            status.textContent = 'EONET: refreshing NASA data...';
        } else if (lastError) {
            status.dataset.state = 'error';
            status.textContent = `EONET: refresh failed - ${lastError.message || 'network error'}`;
        } else if (enabled) {
            status.textContent = `EONET: auto on - last ${formatClock(lastRefresh)}, next ${formatClock(nextRefresh)}`;
        } else {
            status.textContent = lastRefresh
                ? `EONET: auto off - last ${formatClock(lastRefresh)}`
                : 'EONET: manual refresh';
        }
    }

    function updateDataSourceStatus({ state: statusState = 'off', message = 'Data source: NASA EONET default' } = {}) {
        const status = byId('dataSourceStatus');
        if (!status) return;
        status.dataset.state = statusState;
        status.textContent = message;
    }

    function updateSeismicLayerStatus({ enabled = false, loading = false, state: statusState = 'off', message = 'USGS quakes: 24h layer off' } = {}) {
        const button = byId('seismicLayerBtn');
        const status = byId('liveLayerStatus');
        if (button) button.textContent = `USGS quakes: ${enabled ? 'on' : 'off'}`;
        if (!status) return;
        status.dataset.state = loading ? 'refreshing' : statusState;
        status.textContent = message;
    }

    function updateFirmsLayerStatus({ enabled = false, loading = false, state: statusState = 'off', message = 'NASA FIRMS: off' } = {}) {
        const button = byId('firmsLayerBtn');
        const status = byId('firmsLayerStatus');
        if (button) button.textContent = `NASA FIRMS fires: ${enabled ? 'on' : 'off'}`;
        if (!status) return;
        status.dataset.state = loading ? 'refreshing' : statusState;
        status.textContent = message;
    }

    function updateAuroraLayerStatus({ enabled = false, loading = false, state: statusState = 'off', message = 'Aurora: NOAA OVATION off' } = {}) {
        const button = byId('auroraLayerBtn');
        const status = byId('auroraLayerStatus');
        if (button) button.textContent = `Aurora: ${enabled ? 'on' : 'off'}`;
        if (!status) return;
        status.dataset.state = loading ? 'refreshing' : statusState;
        status.textContent = message;
    }

    function updateIssLayerUi({ enabled = state.issLayer, tracking = false } = {}) {
        const button = byId('issLayerBtn');
        const trackButton = byId('trackIssBtn');
        if (button) button.textContent = `ISS: ${enabled ? 'on' : 'off'}`;
        if (trackButton) {
            trackButton.disabled = !enabled;
            trackButton.textContent = tracking ? 'Tracking ISS' : 'Track ISS';
        }
    }

    function updateMoonTextureUi(source = 'coryg89') {
        const button = byId('moonTextureBtn');
        if (button) button.textContent = `Moon texture: ${source === 'nasa' ? 'NASA (public domain)' : 'CoryG89 (default)'}`;
    }

    function updateZodiacalIntensityUi() {
        const slider = byId('zodiacalIntensity');
        const value = byId('zodiacalIntensityValue');
        if (slider) slider.value = String(state.zodiacalIntensity);
        if (value) value.textContent = `${state.zodiacalIntensity.toFixed(1)}x`;
    }

    function updateNoctilucentUi() {
        const preset = byId('noctilucentPreset');
        const slider = byId('noctilucentIntensity');
        const value = byId('noctilucentIntensityValue');
        if (preset) preset.value = state.noctilucentPreset || 'scientific';
        if (slider) slider.value = String(state.noctilucentIntensity);
        if (value) value.textContent = `${state.noctilucentIntensity.toFixed(1)}x`;
    }

    function updateAirglowUi() {
        const preset = byId('airglowPreset');
        const slider = byId('airglowIntensity');
        const value = byId('airglowIntensityValue');
        if (preset) preset.value = state.airglowPreset || 'scientific';
        if (slider) slider.value = String(state.airglowIntensity);
        if (value) value.textContent = `${state.airglowIntensity.toFixed(1)}x`;
    }

    function setPanelsHidden(hidden) {
        const hudToggle = byId('hudToggle');
        document.body.classList.toggle('panels-hidden', hidden);
        if (hudToggle) hudToggle.textContent = hidden ? '\u2630' : '\u00d7';
    }

    function initResponsivePanels() {
        if (innerWidth <= 760) setPanelsHidden(true);
    }

    function wire({
        loadEvents,
        applyNightLook,
        enableRealClouds,
        disableRealClouds,
        applyBrandPreset,
        fitGlobeTo916,
        updateVerticalDirector,
        applyMotionPreset,
        applyReelMood,
        applyEarthLook,
        applyAtmosphereMode,
        applyOceanFresnel,
        applySSSIce,
        applyMaterialMode,
        exportReelPng,
        exportReelVideo,
        exportReelVideoH264,
        applyShowcaseReelPreset,
        startDemoReel,
        exportStillPng,
        toggleEonetAutoRefresh,
        updateDataSourceMode,
        toggleSeismicLayer,
        toggleFirmsLayer,
        toggleAuroraLayer,
        toggleIssLayer,
        trackIss,
        toggleAirglowLayer,
        updateAirglowSettings,
        toggleZodiacalLight,
        toggleNoctilucentClouds,
        updateNoctilucentSettings,
        toggleMoonTexture,
        toggleMoonMarkers,
        updateZodiacalIntensity,
        applySocialPreset,
        setSocialPresetCustom,
        updateCaptionSettings,
        updateDataRhythm
    }) {
        disposed = false;
        byId('refreshBtn').addEventListener('click', loadEvents);
        byId('autoRefreshBtn')?.addEventListener('click', () => {
            toggleEonetAutoRefresh?.();
        });
        byId('daysFilter').addEventListener('change', loadEvents);
        byId('categoryFilter').addEventListener('change', loadEvents);
        byId('statusFilter').addEventListener('change', loadEvents);
        byId('dataSourceFilter')?.addEventListener('change', event => {
            updateDataSourceMode?.(event.target.value);
            loadEvents();
        });
        byId('nightBtn').addEventListener('click', () => {
            applyNightLook(!state.night);
        });
        byId('realCloudBtn').addEventListener('click', async () => {
            if (state.realClouds) disableRealClouds();
            else await enableRealClouds();
        });
        byId('seismicLayerBtn')?.addEventListener('click', async () => {
            await toggleSeismicLayer?.();
        });
        byId('firmsLayerBtn')?.addEventListener('click', async () => {
            await toggleFirmsLayer?.();
        });
        byId('auroraLayerBtn')?.addEventListener('click', async () => {
            await toggleAuroraLayer?.();
        });
        byId('issLayerBtn')?.addEventListener('click', async () => {
            await toggleIssLayer?.();
        });
        byId('trackIssBtn')?.addEventListener('click', async () => {
            await trackIss?.();
        });
        byId('airglowLayerBtn')?.addEventListener('click', () => {
            toggleAirglowLayer?.();
        });
        byId('airglowPreset')?.addEventListener('change', event => {
            updateAirglowSettings?.({ preset: event.target.value });
        });
        byId('airglowIntensity')?.addEventListener('input', event => {
            updateAirglowSettings?.({ intensity: Number(event.target.value) });
        });
        byId('zodiacalLightBtn')?.addEventListener('click', () => {
            toggleZodiacalLight?.();
        });
        byId('noctilucentCloudBtn')?.addEventListener('click', () => {
            toggleNoctilucentClouds?.();
        });
        byId('noctilucentPreset')?.addEventListener('change', event => {
            updateNoctilucentSettings?.({ preset: event.target.value });
        });
        byId('noctilucentIntensity')?.addEventListener('input', event => {
            updateNoctilucentSettings?.({ intensity: Number(event.target.value) });
        });
        byId('zodiacalIntensity')?.addEventListener('input', event => {
            updateZodiacalIntensity?.(Number(event.target.value));
        });
        byId('moonTextureBtn')?.addEventListener('click', () => {
            toggleMoonTexture?.();
        });
        byId('moonMarkersBtn')?.addEventListener('click', () => {
            toggleMoonMarkers?.();
        });
        byId('brandPresetBtn').addEventListener('click', () => {
            applyBrandPreset(!state.brandPreset);
        });
        byId('captureBtn').addEventListener('click', () => {
            state.captureMode = !state.captureMode;
            updateCaptureMode();
        });
        byId('hudToggle').addEventListener('click', () => {
            setPanelsHidden(!document.body.classList.contains('panels-hidden'));
        });
        byId('guide916Btn').addEventListener('click', () => {
            state.guide916 = !state.guide916;
            updateGuide916();
        });
        byId('fit916Btn').addEventListener('click', fitGlobeTo916);
        byId('verticalDirectorBtn')?.addEventListener('click', () => {
            setSocialPresetCustom?.();
            updateVerticalDirector?.(!state.verticalDirector);
        });
        byId('motionPreset').addEventListener('change', event => {
            setSocialPresetCustom?.();
            applyMotionPreset(event.target.value);
        });
        byId('reelMood').addEventListener('change', event => {
            setSocialPresetCustom?.();
            applyReelMood(event.target.value);
        });
        byId('earthLook').addEventListener('change', event => {
            setSocialPresetCustom?.();
            applyEarthLook(event.target.value);
        });
        byId('socialPreset')?.addEventListener('change', event => {
            applySocialPreset?.(event.target.value);
        });
        byId('captionStyle')?.addEventListener('change', event => {
            setSocialPresetCustom?.();
            updateCaptionSettings?.({ style: event.target.value });
        });
        byId('poeticCaptionBtn')?.addEventListener('click', () => {
            setSocialPresetCustom?.();
            updateCaptionSettings?.({ poetic: !state.poeticCaptions });
        });
        byId('dataRhythmBtn')?.addEventListener('click', () => {
            setSocialPresetCustom?.();
            updateDataRhythm?.(!state.dataRhythm);
        });
        byId('atmosphereModeBtn')?.addEventListener('click', () => {
            setSocialPresetCustom?.();
            applyAtmosphereMode?.(state.atmosphereMode === 'physical' ? 'simple' : 'physical');
        });
        byId('oceanFresnelBtn')?.addEventListener('click', () => {
            applyOceanFresnel?.(!state.oceanFresnel);
        });
        byId('sssIceBtn')?.addEventListener('click', () => {
            applySSSIce?.(!state.sssIce);
        });
        byId('materialModeBtn')?.addEventListener('click', () => {
            applyMaterialMode?.(state.materialMode === 'pbr' ? 'phong' : 'pbr');
        });
        byId('reelDuration').addEventListener('input', event => {
            setSocialPresetCustom?.();
            state.reelDurationSec = Number(event.target.value);
            updateReelDurationUi();
        });
        byId('spinSpeed').addEventListener('input', event => {
            state.spinFast = Number(event.target.value);
            updateSpinUi();
        });
        byId('snapDuration').addEventListener('input', event => {
            state.snapDuration = Number(event.target.value);
            updateSpinUi();
        });
        byId('exportReelBtn').addEventListener('click', exportReelPng);
        byId('exportReelVideoBtn').addEventListener('click', async () => {
            await exportReelVideo();
        });
        byId('exportReelVideoH264Btn')?.addEventListener('click', async () => {
            await exportReelVideoH264();
        });
        byId('showcaseReelBtn')?.addEventListener('click', () => {
            applyShowcaseReelPreset?.();
        });
        byId('demoReelBtn').addEventListener('click', () => {
            startDemoReel();
        });
        byId('exportPngBtn').addEventListener('click', exportStillPng);

        keydownHandler = event => {
            if (event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                state.captureMode = !state.captureMode;
                updateCaptureMode();
            }
        };
        addEventListener('keydown', keydownHandler);
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        if (keydownHandler) {
            removeEventListener('keydown', keydownHandler);
            keydownHandler = null;
        }

        // These controls are owned by this runtime. Fresh clones release all
        // listener closures before a later module instance wires them again.
        const toolbar = byId('toolbar');
        if (toolbar) {
            const cleanChildren = Array.from(toolbar.children, child => child.cloneNode(true));
            toolbar.replaceChildren(...cleanChildren);
        }
        const hudToggle = byId('hudToggle');
        if (hudToggle) hudToggle.replaceWith(hudToggle.cloneNode(true));
    }

    return {
        updateCaptureMode,
        updateGuide916,
        updateVerticalDirectorUi,
        updateReelDurationUi,
        updateSpinUi,
        updateBrandPreset,
        updateReelMoodUi,
        updateMotionPresetUi,
        updateSocialPresetUi,
        updateCaptionUi,
        updateDataRhythmUi,
        updateEonetRefreshStatus,
        updateDataSourceStatus,
        updateSeismicLayerStatus,
        updateFirmsLayerStatus,
        updateAuroraLayerStatus,
        updateIssLayerUi,
        updateMoonTextureUi,
        updateZodiacalIntensityUi,
        updateAirglowUi,
        updateNoctilucentUi,
        setPanelsHidden,
        initResponsivePanels,
        wire,
        dispose
    };
}
