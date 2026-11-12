import { createAppLifecycle } from './app-lifecycle.js';
import { createAppStartup } from './app-startup.js';
import { createDemoReelTimeline } from './reel-timeline.js';
import { createSocialPresetSystem } from './preset-system.js';
import { createFramePerformanceSampler } from './performance-sampler.js';

export function createEarthAppRuntime({
    state,
    camera,
    renderer,
    composer,
    bloomPass,
    bloomResolutionScale,
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
    windParticles,
    oceanCurrents,
    eonetAutoRefresh,
    liveDataLayers,
    layerRegistry,
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
    updateTerminatorGuideUi,
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
    showReelCodeSnippet,
    hideReelCodeSnippet,
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
    updateCameraDrift,
    surfaceVisualLock,
    setTerminatorGuideVisible
}) {
    let animationFrameId = null;
    let running = false;
    let disposed = false;
    let controlsWired = false;
    const performanceSampler = createFramePerformanceSampler();

    applyReelMood(state.reelMood);

    const appLifecycle = createAppLifecycle({
        camera,
        renderer,
        composer,
        bloomPass,
        bloomResolutionScale,
        smaaPass,
        solarRuntime,
        eonetAutoRefresh,
        state,
        updateGuide916,
        enableRealClouds,
        surfaceVisualLock
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
        showReelCodeSnippet,
        hideReelCodeSnippet,
        selectEvent,
        deselectAll,
        exportReelVideo,
        exportReelVideoH264,
        triggerSignalPulse,
        moonSystem,
        issSystem,
        updateIssLayerUi,
        startIssTracking,
        stopIssTracking,
        startMoonTracking,
        stopMoonTracking,
        startReturnFromMoon
    });

    async function startDemoReel() {
        await demoReel.start(state.filtered);
    }

    function isLocalCaptureEnvironment() {
        const hostname = window.location.hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    }

    function updateLocalAutoCaptureUi() {
        if (!isLocalCaptureEnvironment()) return;
        const button = document.getElementById('autoCaptureBtn');
        if (!button) return;
        button.textContent = 'Auto-capture (Local cinema • H.264 16:9)';
        button.title = 'Local-only cinematic capture: slower guided pacing, Black Marble night look and H.264 conversion through the local proxy + FFmpeg. The public/cPanel behavior is unchanged.';
    }

    // Captura automata dedicata: in productie pastreaza turul actual. Doar
    // localhost activeaza ritmul "Local cinema" si look-ul nocturn temporar;
    // demoReel restaureaza starea precedenta dupa export.
    async function startAutoCaptureH264() {
        const localCinematic = isLocalCaptureEnvironment();
        await demoReel.start(state.filtered, {
            codec: 'h264',
            aspect: '16:9',
            durationSec: localCinematic ? 68 : 50,
            includeIss: true,
            eventCount: 2,
            localCinematic
        });
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

    function toggleTerminatorGuide() {
        state.terminatorGuide = !state.terminatorGuide;
        setTerminatorGuideVisible?.(state.terminatorGuide);
        updateTerminatorGuideUi?.();
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

    // Statusurile vant/curenti si linia "Data source" contin varste relative
    // (data/fetched); le recalculam din timestamp-uri la 30 s, din bucla de
    // animatie existenta.
    let lastFieldStatusRefresh = null;
    function refreshFieldStatuses(t) {
        if (lastFieldStatusRefresh !== null && t - lastFieldStatusRefresh < 30) return;
        lastFieldStatusRefresh = t;
        if (state.windParticles) controlPanel.updateWindLayerStatus?.(windParticles?.getStatus?.());
        if (state.oceanCurrents) controlPanel.updateOceanLayerStatus?.(oceanCurrents?.getStatus?.());
        controlPanel.refreshDataSourceStatus?.();
    }

    async function toggleWindLayer() {
        const next = !state.windParticles;
        state.windParticles = next;
        await windParticles?.setEnabled?.(next);
        controlPanel.updateWindLayerStatus?.(windParticles?.getStatus?.());
    }

    async function toggleOceanLayer() {
        const next = !state.oceanCurrents;
        state.oceanCurrents = next;
        await oceanCurrents?.setEnabled?.(next);
        controlPanel.updateOceanLayerStatus?.(oceanCurrents?.getStatus?.());
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
            startAutoCaptureH264,
            exportStillPng,
            toggleEonetAutoRefresh: () => eonetAutoRefresh.toggle(),
            updateDataSourceMode,
            toggleSeismicLayer: () => liveDataLayers.toggleUsgsQuakes(loadEvents),
            toggleFirmsLayer: () => liveDataLayers.toggleFirmsWildfires(loadEvents),
            toggleWindLayer,
            toggleOceanLayer,
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
            updateDataRhythm,
            toggleTerminatorGuide
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
        setTerminatorGuideVisible?.(state.terminatorGuide);
        updateTerminatorGuideUi?.();
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
        if (!running || disposed) return;
        performanceSampler.record(performance.now());
        const t = clock.getElapsedTime();
        demoReel.update(t);
        updateFocus(t, () => demoReel.onFocusComplete());
        updateMarkerAnimation(t, currentReelMood().markerPulseAmp * (state.dataRhythmPulseAmp || 1), camera);
        frameRuntime.update(t);
        moonSystem?.update?.(camera, t);
        issSystem?.update?.(camera);
        airglowSystem?.update?.(camera, t);
        zodiacalLightSystem?.update?.(camera, t);
        noctilucentCloudSystem?.update?.(camera, t);
        windParticles?.update?.(t);
        oceanCurrents?.update?.(t);
        refreshFieldStatuses(t);
        liveDataLayers.update(t);
        layerRegistry?.update?.(t);
        updateCameraControls();
        positionReelCaptionForCamera(camera);
        updateSignalPulseForCamera(camera, t);
        updateCameraDrift(t);
        surfaceVisualLock?.enforce?.();
        // Pastreaza preview-ul live in timpul exportului. Exportul foloseste
        // un composer separat, insa utilizatorul trebuie sa poata urmari turul
        // pe canvasul principal, nu sa vada un cadru static pana la final.
        composer.render();
        animationFrameId = requestAnimationFrame(animate);
    }

    function startAnimation() {
        if (running || disposed) return;
        running = true;
        animationFrameId = requestAnimationFrame(animate);
    }

    function stopAnimation() {
        running = false;
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
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
        startAnimation
    });

    function start() {
        if (disposed) return;
        appLifecycle.start();
        if (!controlsWired) {
            wireControls();
            controlsWired = true;
        }
        applyUrlPresentationPreset();
        updateLocalAutoCaptureUi();
        if (state.firmsWildfires) {
            liveDataLayers.setFirmsWildfiresEnabled?.(true);
        }
        const loadPromise = appStartup.start();
        surfaceVisualLock?.apply?.();
        if (state.firmsWildfires) {
            loadPromise?.finally?.(() => liveDataLayers.refreshFirmsStatus?.());
        }
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        stopAnimation();
        demoReel.dispose?.();
        appLifecycle.dispose();
        controlPanel.dispose?.();
    }

    return {
        start,
        animate,
        startAnimation,
        stopAnimation,
        dispose,
        isRunning: () => running && !disposed,
        startDemoReel,
        startAutoCaptureH264,
        demoReel,
        appLifecycle,
        performanceSnapshot: performanceSampler.snapshot
    };
}
