import { createAppLifecycle } from './app-lifecycle.js?v=resizeObserver1';
import { createAppStartup } from './app-startup.js?v=firms1';
import { createDemoReelTimeline } from './reel-timeline.js?v=reelSyncPolish1';
import { createSocialPresetSystem } from './preset-system.js?v=directorModes1';

export function createEarthAppRuntime({
    state,
    camera,
    renderer,
    composer,
    bloomPass,
    smaaPass,
    controls,
    clock,
    controlPanel,
    solarRuntime,
    moonSystem,
    moonMarkers,
    issSystem,
    airglowSystem,
    zodiacalLightSystem,
    noctilucentCloudSystem,
    eonetAutoRefresh,
    liveDataLayers,
    frameRuntime,
    currentReelMood,
    eventLonLat,
    eventCategory,
    eventSortAge,
    eventRecency,
    eventMagnitudeScale,
    dataRhythmCamera,
    loadEvents,
    applyNightLook,
    enableRealClouds,
    disableRealClouds,
    applyBrandPreset,
    fitGlobeTo916,
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
    exportStillPng,
    updateCaptureMode,
    updateBrandPreset,
    updateGuide916,
    updateVerticalDirectorUi,
    updateReelDurationUi,
    updateSpinUi,
    updateSocialPresetUi,
    updateCaptionUi,
    updateDataRhythmUi,
    updateIssLayerUi,
    updateMoonTextureUi,
    updateZodiacalIntensityUi,
    updateAirglowUi,
    updateNoctilucentUi,
    updateDataSourceStatus,
    updateReelVideoButton,
    updateReelTitleCard,
    updateReelTransitionCard,
    updateReelCaption,
    updateReelDetailsCard,
    hideReelCaption,
    positionReelCaptionForCamera,
    triggerSignalPulse,
    updateSignalPulseForCamera,
    selectEvent,
    deselectAll,
    focus,
    startIssTracking,
    stopIssTracking,
    startMoonTracking,
    stopMoonTracking,
    startReturnFromMoon,
    updateFocus,
    updateMarkerAnimation,
    updateCameraControls,
    updateCameraDrift
}) {
    applyReelMood(state.reelMood);

    const appLifecycle = createAppLifecycle({
        camera,
        renderer,
        composer,
        bloomPass,
        smaaPass,
        solarRuntime,
        eonetAutoRefresh,
        state,
        updateGuide916,
        enableRealClouds
    });

    const demoReel = createDemoReelTimeline({
        state,
        controls,
        focus,
        getTime: () => clock.getElapsedTime(),
        currentReelMood,
        eventLonLat,
        eventCategory,
        eventSortAge,
        eventRecency,
        eventMagnitudeScale,
        dataRhythmCamera,
        updateReelDurationUi,
        updateSpinUi,
        updateCaptureMode,
        applyNightLook,
        applyMotionPreset,
        applyEarthLook,
        applyAtmosphereMode,
        applyReelMood,
        applyBrandPreset,
        updateReelTitleCard,
        updateReelTransitionCard,
        updateReelCaption,
        updateReelDetailsCard,
        hideReelCaption,
        selectEvent,
        deselectAll,
        exportReelVideo,
        triggerSignalPulse,
        moonSystem,
        startMoonTracking,
        stopMoonTracking,
        startReturnFromMoon
    });

    async function startDemoReel() {
        await demoReel.start(state.filtered);
    }

    function applyShowcaseReelPreset() {
        state.socialPreset = 'igCinematic';
        updateSocialPresetUi?.();
        state.verticalDirector = true;
        updateVerticalDirectorUi?.();
        state.reelDurationSec = 24;
        updateReelDurationUi();
        applyReelMood('cinematic');
        applyEarthLook('showcase');
        applyAtmosphereMode('physical');
        applyMotionPreset('slowOrbit');
        if (!state.guide916) {
            state.guide916 = true;
            updateGuide916();
        }
        fitGlobeTo916();
    }

    const socialPresetSystem = createSocialPresetSystem({
        state,
        updateSocialPresetUi,
        updateReelDurationUi,
        updateVerticalDirectorUi,
        updateCaptionUi,
        updateDataRhythmUi,
        updateGuide916,
        fitGlobeTo916,
        applyMotionPreset,
        applyReelMood,
        applyEarthLook,
        applyAtmosphereMode,
        applyBrandPreset
    });

    function updateVerticalDirector(enabled) {
        state.verticalDirector = Boolean(enabled);
        if (state.verticalDirector && !state.guide916) {
            state.guide916 = true;
            updateGuide916();
        }
        updateVerticalDirectorUi?.();
    }

    function updateCaptionSettings({ style = null, poetic = null } = {}) {
        if (style) state.captionStyle = style;
        if (poetic !== null) state.poeticCaptions = Boolean(poetic);
        updateCaptionUi?.();
    }

    function updateDataRhythm(enabled) {
        state.dataRhythm = Boolean(enabled);
        if (!state.dataRhythm) dataRhythmCamera?.reset?.();
        updateDataRhythmUi?.();
    }

    async function toggleIssLayer() {
        state.issLayer = !state.issLayer;
        if (!state.issLayer) stopIssTracking?.();
        await issSystem?.setEnabled?.(state.issLayer);
        updateIssLayerUi?.({ enabled: state.issLayer });
    }

    async function trackIss() {
        if (!state.issLayer) {
            state.issLayer = true;
            await issSystem?.setEnabled?.(true);
            updateIssLayerUi?.({ enabled: true });
        }
        const s = issSystem?.issState;
        if (!s?.visible) return;
        startIssTracking?.(s);
        updateIssLayerUi?.({ enabled: true, tracking: true });
    }

    function toggleAirglowLayer() {
        state.airglowLayer = !state.airglowLayer;
        airglowSystem?.setEnabled?.(state.airglowLayer);
    }

    function updateAirglowSettings({ preset, intensity } = {}) {
        if (preset) {
            state.airglowPreset = preset === 'cinematic' ? 'cinematic' : 'scientific';
            airglowSystem?.setPreset?.(state.airglowPreset);
        }
        if (intensity !== undefined) {
            state.airglowIntensity = Math.max(0.25, Math.min(2.4, Number(intensity) || 1));
            airglowSystem?.setIntensity?.(state.airglowIntensity);
        }
        updateAirglowUi?.();
    }

    function toggleZodiacalLight() {
        state.zodiacalLight = !state.zodiacalLight;
        zodiacalLightSystem?.setEnabled?.(state.zodiacalLight);
    }

    function updateZodiacalIntensity(value) {
        state.zodiacalIntensity = Math.max(0.35, Math.min(2.2, Number(value) || 1));
        zodiacalLightSystem?.setIntensity?.(state.zodiacalIntensity);
        updateZodiacalIntensityUi?.();
    }

    function toggleNoctilucentClouds() {
        state.noctilucentClouds = !state.noctilucentClouds;
        noctilucentCloudSystem?.setEnabled?.(state.noctilucentClouds);
    }

    function updateNoctilucentSettings({ preset, intensity } = {}) {
        if (preset) {
            state.noctilucentPreset = preset === 'cinematic' ? 'cinematic' : 'scientific';
            noctilucentCloudSystem?.setPreset?.(state.noctilucentPreset);
        }
        if (intensity !== undefined) {
            state.noctilucentIntensity = Math.max(0.25, Math.min(2.4, Number(intensity) || 1));
            noctilucentCloudSystem?.setIntensity?.(state.noctilucentIntensity);
        }
        updateNoctilucentUi?.();
    }

    function toggleMoonTexture() {
        const next = moonSystem?.moonState?.textureSource === 'coryg89' ? 'nasa' : 'coryg89';
        moonSystem?.setTextureSource?.(next);
        updateMoonTextureUi?.(next);
    }

    function toggleMoonMarkers() {
        moonMarkers?.toggle?.();
    }

    function updateDataSourceMode(value) {
        state.dataSourceMode = value || 'eonet';
    }

    function wireControls() {
        controlPanel.wire({
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
            toggleEonetAutoRefresh: () => eonetAutoRefresh.toggle(),
            updateDataSourceMode,
            toggleSeismicLayer: () => liveDataLayers.toggleUsgsQuakes(loadEvents),
            toggleFirmsLayer: () => liveDataLayers.toggleFirmsWildfires(loadEvents),
            toggleAuroraLayer: liveDataLayers.toggleAuroraLayer,
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
            applySocialPreset: socialPresetSystem.applySocialPreset,
            setSocialPresetCustom: socialPresetSystem.setCustom,
            updateCaptionSettings,
            updateDataRhythm
        });
        controlPanel.initResponsivePanels();
        updateIssLayerUi?.({ enabled: state.issLayer });
        updateMoonTextureUi?.(moonSystem?.moonState?.textureSource);
        updateDataSourceStatus?.({
            state: state.dataSourceState,
            message: state.dataSourceMessage
        });
        updateZodiacalIntensityUi?.();
        updateAirglowUi?.();
        updateNoctilucentUi?.();
        airglowSystem?.setPreset?.(state.airglowPreset);
        airglowSystem?.setIntensity?.(state.airglowIntensity);
        airglowSystem?.setEnabled?.(state.airglowLayer);
        zodiacalLightSystem?.setIntensity?.(state.zodiacalIntensity);
        zodiacalLightSystem?.setEnabled?.(state.zodiacalLight);
        noctilucentCloudSystem?.setPreset?.(state.noctilucentPreset);
        noctilucentCloudSystem?.setIntensity?.(state.noctilucentIntensity);
        noctilucentCloudSystem?.setEnabled?.(state.noctilucentClouds);
    }

    function applyUrlPresentationPreset() {
        const params = new URLSearchParams(window.location.search);
        const isPresentation = params.has('presentation') || params.has('demo');
        const sourceParam = params.get('source') || params.get('dataSource');
        if (['eonet', 'smart', 'gdacs'].includes(sourceParam)) {
            state.dataSourceMode = sourceParam;
            const sourceSelect = document.getElementById('dataSourceFilter');
            if (sourceSelect) sourceSelect.value = sourceParam;
        }

        const socialPreset = params.get('social');
        if (socialPreset) {
            socialPresetSystem.applySocialPreset(socialPreset);
        } else if (isPresentation || params.has('showcase')) {
            applyShowcaseReelPreset();
        }

        if (params.has('noctilucent')) {
            state.noctilucentClouds = true;
            const noctilucentPreset = params.get('noctilucentPreset') || params.get('nlcPreset');
            if (['scientific', 'cinematic'].includes(noctilucentPreset)) {
                state.noctilucentPreset = noctilucentPreset;
            }
            const noctilucentIntensity = Number(params.get('noctilucentIntensity') || params.get('nlcIntensity'));
            if (Number.isFinite(noctilucentIntensity)) {
                state.noctilucentIntensity = Math.max(0.25, Math.min(2.4, noctilucentIntensity));
            }
            noctilucentCloudSystem?.setPreset?.(state.noctilucentPreset);
            noctilucentCloudSystem?.setIntensity?.(state.noctilucentIntensity);
            noctilucentCloudSystem?.setEnabled?.(true);
            updateNoctilucentUi?.();
        }

        if (params.has('airglow')) {
            state.airglowLayer = true;
            const airglowPreset = params.get('airglowPreset');
            if (['scientific', 'cinematic'].includes(airglowPreset)) {
                state.airglowPreset = airglowPreset;
            }
            const airglowIntensity = Number(params.get('airglowIntensity'));
            if (Number.isFinite(airglowIntensity)) {
                state.airglowIntensity = Math.max(0.25, Math.min(2.4, airglowIntensity));
            }
            airglowSystem?.setPreset?.(state.airglowPreset);
            airglowSystem?.setIntensity?.(state.airglowIntensity);
            airglowSystem?.setEnabled?.(true);
            updateAirglowUi?.();
        }

        if (params.has('firms')) {
            state.firmsWildfires = true;
        }

        if (isPresentation) {
            controlPanel.setPanelsHidden(true);
        }
    }

    function animate() {
        const t = clock.getElapsedTime();
        demoReel.update(t);
        updateFocus(t, () => demoReel.onFocusComplete());
        updateMarkerAnimation(t, currentReelMood().markerPulseAmp * (state.dataRhythmPulseAmp || 1));
        frameRuntime.update(t);
        moonSystem?.update?.(camera, t);
        issSystem?.update?.(camera);
        airglowSystem?.update?.(camera, t);
        zodiacalLightSystem?.update?.(camera, t);
        noctilucentCloudSystem?.update?.(camera, t);
        liveDataLayers.update(t);
        updateCameraControls();
        positionReelCaptionForCamera(camera);
        updateSignalPulseForCamera(camera, t);
        updateCameraDrift(t);
        composer.render();
        requestAnimationFrame(animate);
    }

    const appStartup = createAppStartup({
        state,
        loadEvents,
        updateCaptureMode,
        updateBrandPreset,
        updateGuide916,
        updateVerticalDirectorUi,
        updateCaptionUi,
        updateDataRhythmUi,
        updateReelDurationUi,
        updateSocialPresetUi,
        updateReelVideoButton,
        applyMotionPreset,
        applyEarthLook,
        applyAtmosphereMode,
        animate
    });

    function start() {
        appLifecycle.start();
        wireControls();
        applyUrlPresentationPreset();
        if (state.firmsWildfires) {
            liveDataLayers.setFirmsWildfiresEnabled?.(true);
        }
        const loadPromise = appStartup.start();
        if (state.firmsWildfires) {
            loadPromise?.finally?.(() => liveDataLayers.refreshFirmsStatus?.());
        }
    }

    return {
        start,
        animate,
        startDemoReel,
        demoReel,
        appLifecycle
    };
}
