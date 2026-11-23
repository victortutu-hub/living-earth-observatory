import { createEarthAppearance } from './earth-appearance.js';
import { heroDriftProfiles, motionPresets, reelMoodPresets } from './reel-presets.js';
import { EONET_API, officialCategories, officialCategoryLabels } from './eonet-config.js';
import { createGdacsProvider } from './gdacs-provider.refactored.js';
import { createReelOverlay } from './reel-overlay.js';
import { editorialSelection } from './reel-timeline.js';
import { createExportSystem } from './export-system.js';
import { createControlPanel } from './control-panel.js';
import { createEonetAutoRefreshController } from './eonet-data.js';
import { createEonetApp } from './eonet-app.js';
import { createCameraMotionRuntime } from './camera-motion.js';
import { createEarthAppRuntime } from './app-runtime.js';
import { createTimeScrubPanel } from './time-scrub-panel.js';
import { createLiveDataLayers } from './live-data-layers.js';
import { createLayerRegistry } from './layer-plugin-registry.js';
import { gvpVolcanoesPlugin } from './layers/gvp-volcanoes.js';
import { himalayaPeaksPlugin, setHimalayaSceneTimeProvider } from './layers/himalaya-peaks.js';
import { HIMALAYA_REGION_CENTER } from '../config/himalaya-peaks.js';
import { auroraPlugin } from './layers/aurora.js';
import { snowIcePlugin } from './layers/snow-ice.js';
import { lookDefaults } from './app-state.js';
import { createEventScene } from './event-scene.js';
import { createAppVisualFoundation } from './app-visual-foundation.js';
import { createDataRhythmCamera } from './data-rhythm-camera.js';
import { createMoonMarkers } from './moon-markers.js';
import { describeMoonTextures, localDirForSelenographic } from './moon-system.js';
import { describeMoonExposure, describeMoonIllumination } from './scene-lighting.js';
import { createSurfaceVisualLock, surfaceVisualMaterialDebugFromSearch } from './surface-visual-lock.js';
import { atlasStatus } from '../core/status-store.js';
import { getAstronomyImportState } from './astronomy-runtime.js';
import { describeCameraView } from './moon-viewpoint.js';

export function createEarthAppServices({
    THREE,
    earcut,
    state,
    sceneRuntime,
    bootstrap
}) {
    const {
        scene,
        camera,
        renderer,
        controls,
        earthGroup,
        composer,
        bloomPass,
        bloomResolutionScale,
        smaaPass
    } = sceneRuntime;
    // THREE.Timer (THREE.Clock is deprecated in r185): app-runtime calls
    // timer.update() once at the start of every frame; getElapsed() then gives
    // the same seconds-since-start as Clock.getElapsedTime(), constant within a
    // frame. Not connected to the Page Visibility API, so hidden time still
    // counts, as it did with Clock.
    const timer = new THREE.Timer();
    const visualFoundation = createAppVisualFoundation({
        THREE,
        state,
        sceneRuntime,
        bootstrap,
        getTime: () => timer.getElapsed()
    });
    const {
        lonLatToVec3,
        latestGeometry,
        eventCategory,
        eventColor,
        eventLonLat,
        eventDate,
        eventAgeDays,
        eventRecency,
        eventSortAge,
        eventMagnitudeScale,
        recentBadge,
        eventPolygonRings,
        solarRuntime,
        timeState,
        moonSystem,
        issSystem,
        airglowSystem,
        zodiacalLightSystem,
        noctilucentCloudSystem,
        windParticles,
        oceanCurrents,
        coolFill,
        updateCoolFillDirection,
        earthMat,
        getEarthMatPBR,
        setMaterialMode,
        setSurfaceMaterialResponseEnabled,
        getSurfaceMaterialDebugSnapshot,
        surfaceReady,
        nightLights,
        setTerminatorGuideVisible,
        cloudMat,
        cloudOverlayMat,
        atmosphereMat,
        applyAtmosphereLayerMode,
        frameRuntime,
        enableRealClouds,
        disableRealClouds,
        applyNightLook,
        setApplyNightLookHandler
    } = visualFoundation;

    function currentReelMood() {
        return reelMoodPresets[state.reelMood] || reelMoodPresets.cinematic;
    }

    const reelOverlay = createReelOverlay({
        THREE,
        scene,
        getTime: () => timer.getElapsed(),
        currentReelMood,
        officialCategoryLabels,
        latestGeometry,
        eventCategory,
        eventColor,
        eventLonLat,
        lonLatToVec3,
        state
    });
    const {
        updateReelCaption,
        updateReelDetailsCard,
        updateReelTransitionCard,
        updateReelTitleCard,
        hideReelCaption,
        showReelCodeSnippet,
        hideReelCodeSnippet,
        positionReelCaptionForCamera,
        triggerSignalPulse,
        updateSignalPulseForCamera
    } = reelOverlay;

    const eventScene = createEventScene({
        THREE,
        state,
        earthGroup,
        renderer,
        camera,
        earcut,
        eventLonLat,
        eventCategory,
        eventColor,
        eventDate,
        eventAgeDays,
        eventRecency,
        eventMagnitudeScale,
        eventPolygonRings,
        lonLatToVec3
    });
    const {
        addMarkers,
        clearSelectionTrail,
        buildSelectionTrail,
        updateMarkerAnimation,
        markerGroup,
        trailGroup
    } = eventScene;

    const moonMarkers = createMoonMarkers({
        THREE,
        moon: moonSystem.moon,
        localDirForSelenographic
    });

    const timeScrubPanel = createTimeScrubPanel({ timeState });

    const controlPanel = createControlPanel({ state });
    const {
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
        updateTerminatorGuideUi,
        updateEonetRefreshStatus,
        updateDataSourceStatus,
        updateNightLightsStatus,
        updateSurfaceStatus,
        updateSeismicLayerStatus,
        updateFirmsLayerStatus,
        updateIssLayerUi,
        updateZodiacalIntensityUi,
        updateAirglowUi,
        updateNoctilucentUi
    } = controlPanel;
    visualFoundation.setNightLightsStatusListener?.(updateNightLightsStatus);
    visualFoundation.setSurfaceStatusListener?.(updateSurfaceStatus);

    const liveDataLayers = createLiveDataLayers({
        THREE,
        state,
        earthGroup,
        lonLatToVec3,
        updateSeismicLayerStatus,
        updateFirmsLayerStatus
    });
    const gdacsProvider = createGdacsProvider({ timeoutMs: 30000 });

    const exportSystem = createExportSystem({
        THREE,
        scene,
        camera,
        controls,
        renderer,
        bloomPass,
        smaaPass,
        state,
        getTime: () => timer.getElapsed(),
        updateCaptureMode,
        updateGuide916,
        positionReelCaptionForCamera,
        updateSignalPulseForCamera
    });
    const {
        applyExportCameraFramingTo,
        exportStillPng,
        exportReelPng,
        exportReelVideo,
        exportReelVideoH264,
        updateReelVideoButton
    } = exportSystem;

    const cameraMotion = createCameraMotionRuntime({
        THREE,
        state,
        camera,
        controls,
        motionPresets,
        heroDriftProfiles,
        eventCategory,
        lonLatToVec3,
        getTime: () => timer.getElapsed(),
        applyExportCameraFramingTo,
        updateGuide916,
        updateMotionPresetUi
    });
    const {
        focus,
        applyMotionPreset,
        fitGlobeTo916,
        focusOnLonLat,
        setSelectedCinematic,
        clearSelectedCinematic,
        startIssTracking,
        stopIssTracking,
        startMoonTracking,
        stopMoonTracking,
        startMoonEarthView,
        startMoonMarkerFocus,
        stopMoonMarkerFocus,
        startReturnFromMoon,
        updateFocus,
        updateControls: updateCameraControls,
        updateDrift: updateCameraDrift
    } = cameraMotion;

    const earthAppearance = createEarthAppearance({
        state,
        scene,
        renderer,
        bloomPass,
        lookDefaults,
        earthMat,
        getEarthMatPBR,
        setMaterialMode,
        nightLights,
        cloudMat,
        cloudOverlayMat,
        atmosphereMat,
        coolFill,
        applyAtmosphereLayerMode,
        currentReelMood,
        updateCaptureMode,
        updateCoolFillDirection,
        updateBrandPreset,
        updateReelMoodUi,
        updateSpinUi,
        applyMotionPreset,
        reelMoodPresets
    });
    setApplyNightLookHandler((enabled) => earthAppearance.applyNightLook(enabled));
    const {
        applyEarthLook,
        applyAtmosphereMode,
        applyOceanFresnel,
        applySSSIce,
        applyMaterialMode,
        applyReelMood,
        applyBrandPreset
    } = earthAppearance;

    // Development-only query lock for repeatable 2.4B material comparison.
    // It owns no rendering system; it only freezes the existing scene state.
    const surfaceVisualLock = createSurfaceVisualLock({
        THREE,
        camera,
        controls,
        earthGroup,
        markerGroup,
        trailGroup,
        cloudMat,
        cloudOverlayMat,
        timeState,
        solarRuntime,
        moonSystem,
        issSystem,
        applyMaterialMode
    });

    if (surfaceVisualLock.active && surfaceVisualMaterialDebugFromSearch(window.location.search)) {
        // No control is exposed until the ordinary surface pipeline has settled.
        // The later OFF/ON clicks only alter one uniform on this same map object.
        surfaceReady.then(() => {
        const overlay = document.createElement('div');
        overlay.id = 'surfaceMaterialDebugControls';
        overlay.style.cssText = 'position:fixed;right:18px;top:18px;z-index:1000;display:flex;gap:6px;padding:8px;background:rgba(3,10,20,.86);border:1px solid #4fa8d8;border-radius:6px';
        const status = document.createElement('output');
        status.id = 'surfaceMaterialDebugState';
        status.style.cssText = 'align-self:center;color:#d6f3ff;font:12px monospace';
        const update = (enabled) => {
            setSurfaceMaterialResponseEnabled(enabled);
            const snapshot = getSurfaceMaterialDebugSnapshot();
            status.textContent = `${enabled ? 'ON' : 'OFF'} | ${snapshot.material} | map=${snapshot.mapId} | ${snapshot.width}x${snapshot.height}`;
            status.title = `material=${snapshot.materialId}; source=${snapshot.source}`;
        };
        for (const [label, enabled] of [['OFF', false], ['ON', true]]) {
            const button = document.createElement('button');
            button.id = `surfaceMaterialDebug${label}`;
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', () => update(enabled));
            overlay.append(button);
        }
        update(false);
        overlay.append(status);
        document.body.append(overlay);
        });
    }

    const dataRhythmCamera = createDataRhythmCamera({
        state,
        eventRecency,
        eventMagnitudeScale
    });

    let dataSourceProvider = null; // LOT 23: active event provider ('NASA EONET' / 'GDACS')
    const eonetApp = createEonetApp({
        apiUrl: EONET_API,
        state,
        officialCategories,
        officialCategoryLabels,
        latestGeometry,
        eventCategory,
        eventColor,
        eventDate,
        eventRecency,
        eventSortAge,
        recentBadge,
        editorialSelection,
        supplementalProviders: liveDataLayers.supplementalProviders,
        fallbackProviders: [gdacsProvider],
        onSourceStateChange: status => {
            dataSourceProvider = status.activeProvider || null; // LOT 23: runtime signals
            state.dataSourceState = status.state || 'off';
            state.dataSourceMessage = status.message || 'Data source: NASA EONET default';
            updateDataSourceStatus?.(status);
            // A load of events reached its end (or a new day started): the
            // USGS/FIRMS rows follow it, not only the toggle that started a
            // load which may have been superseded since.
            liveDataLayers.refreshUsgsStatus?.();
            liveDataLayers.refreshFirmsStatus?.();
        },
        getDataDay: () => timeState.dataDay(),
        onDeferredEventsApplied: () => liveDataLayers.refreshFirmsStatus?.(),
        addMarkers,
        focusOnLonLat,
        setSelectedCinematic,
        clearSelectedCinematic,
        clearSelectionTrail,
        buildSelectionTrail,
        stopIssTracking,
        stopMoonTracking
    });
    const {
        selectEvent,
        selectCluster,
        deselectAll,
        loadEvents,
        eventUi
    } = eonetApp;

    // Faza 1 - Sprint 1.1: registry de layere. O sursa noua = 1 fisier plugin +
    // 1 linie register(). GVP (vulcani Smithsonian) e primul test al contractului.
    // Selectia unui punct reutilizeaza exact renderDetails + focusOnLonLat, deci
    // vulcanii se comporta identic cu markerele de evenimente (panou + track).
    const layerRegistry = createLayerRegistry({
        THREE,
        earthGroup,
        lonLatToVec3,
        onSelectFeature: (item) => {
            deselectAll();
            eventUi.renderDetails(item.title || 'Layer feature', item.detail || [], item.action || null);
            if (Number.isFinite(item.lon) && Number.isFinite(item.lat)) {
                focusOnLonLat(item.lon, item.lat);
            }
        }
    });
    layerRegistry.register(gvpVolcanoesPlugin);
    layerRegistry.register(auroraPlugin);
    layerRegistry.register(snowIcePlugin);
    layerRegistry.register(himalayaPeaksPlugin);
    setHimalayaSceneTimeProvider(() => timeState.snapshot());

    // focus=himalaya (returning from Living Himalaya): centre on the region and
    // turn the peaks layer on. Any other focus value is ignored.
    function applyUrlFocus() {
        if (new URLSearchParams(window.location.search).get('focus') !== 'himalaya') return;
        void layerRegistry.enableLayer('himalayaPeaks');
        focusOnLonLat(HIMALAYA_REGION_CENTER.lon, HIMALAYA_REGION_CENTER.lat, 3.9);
    }

    function showIssDetails() {
        deselectAll();
        const s = issSystem?.issState;
        if (!s) return;
        const speedKmS = s.velocityEci
            ? Math.sqrt(s.velocityEci.x ** 2 + s.velocityEci.y ** 2 + s.velocityEci.z ** 2)
            : null;
        eventUi.renderDetails('International Space Station', [
            { label: 'NORAD ID', value: '25544' },
            { label: 'Altitude', value: Number.isFinite(s.altitudeKm) ? `${s.altitudeKm.toFixed(1)} km` : 'unknown' },
            { label: 'Speed', value: speedKmS ? `${speedKmS.toFixed(2)} km/s` : 'unknown' },
            { label: 'Coordinates', value: `${s.latitude.toFixed(2)} lat, ${s.longitude.toFixed(2)} lon` },
            { label: 'Orbit', value: 'SGP4 propagated from CelesTrak TLE' },
            { label: 'Source', value: s.source || 'unknown' }
        ]);
        startIssTracking?.(s);
    }

    function showMoonDetails() {
        deselectAll();
        const m = moonSystem?.moonState;
        if (!m) return;
        eventUi.renderDetails('The Moon', [
            { label: 'Phase', value: Number.isFinite(m.phaseFraction) ? `${Math.round(m.phaseFraction * 100)}% lit from Earth` : 'unknown' }, // LOT 33: geocentric phase
            // LOT 33b: the disc as the camera sees it; the span is kept live by moon-system.js (updateCameraView).
            { label: 'Camera view', value: Object.assign(document.createElement('span'), { id: 'moonCameraViewValue', textContent: describeCameraView(m.cameraLitFraction) }) },
            { label: 'Distance', value: Number.isFinite(m.distanceKm) ? `${Math.round(m.distanceKm).toLocaleString()} km` : 'unknown' },
            { label: 'Sublunar point', value: `${m.sublunarLat.toFixed(2)} lat, ${m.sublunarLon.toFixed(2)} lon` },
            { label: 'Libration', value: Number.isFinite(m.librationElon) ? `${m.librationElon.toFixed(2)}° lon, ${m.librationElat.toFixed(2)}° lat` : 'unknown' },
            // LOT 31: every light that reaches the Moon, read from the live objects.
            { label: 'Illumination', value: describeMoonIllumination({ sunLight: bootstrap.sunLight, earthshine: m.earthshine }) },
            { label: 'Exposure', value: describeMoonExposure(m.exposureEv, m.earthshineViewNote) }, // LOT 31 ETAPA 2 / 2b
            ...describeMoonTextures(m), // LOT 30
            { label: 'Source', value: m.source || 'unknown' }
        ], { label: 'View from Earth', run: () => startMoonEarthView?.(moonSystem.moon) }); // LOT 33b
        startMoonTracking?.(moonSystem.moon, moonSystem.moonState?.sunWorldDir);
    }

    // Reper lunar static (aselenizare Apollo, crater, mare) - catalog curat
    // manual in moon-markers.js, nu un feed live ca EONET. Cardul de detalii
    // foloseste exact acelasi renderDetails ca ISS/Luna intreaga.
    function showMoonMarkerDetails(specialId) {
        const landmark = moonMarkers.findLandmark(specialId);
        if (!landmark) return;
        deselectAll();
        const lines = [
            { label: 'Type', value: landmark.type }
        ];
        if (landmark.mission) lines.push({ label: 'Mission', value: landmark.mission });
        if (landmark.date) lines.push({ label: 'Date', value: landmark.date });
        lines.push({ label: 'Coordinates', value: `${landmark.lat.toFixed(2)} lat, ${landmark.lon.toFixed(2)} lon (selenographic)` });
        lines.push({ label: 'About', value: landmark.description });
        eventUi.renderDetails(landmark.name, lines);
        const markerMesh = moonMarkers.meshForLandmarkId(landmark.id);
        startMoonMarkerFocus?.(markerMesh, moonSystem.moon);
    }

    eventScene.attachInteraction({
        onSelectCluster: selectCluster,
        onSelectEvent: selectEvent,
        getPointPickables: () => layerRegistry.getPointObjects(),
        onSelectPointPickable: (object, index) => layerRegistry.selectPoint(object, index),
        extraObjects: [issSystem?.iss, issSystem?.issHalo, moonSystem?.moon, ...moonMarkers.markerMeshes].filter(Boolean),
        onSelectExtra: id => {
            if (id === 'iss') showIssDetails();
            else if (id === 'moon') showMoonDetails();
            else if (id?.startsWith('moonMarker:')) showMoonMarkerDetails(id);
        }
    });

    const eonetAutoRefresh = createEonetAutoRefreshController({
        refresh: () => loadEvents({ silent: true }),
        onStateChange: updateEonetRefreshStatus
    });

    const appRuntime = createEarthAppRuntime({
        state,
        camera,
        renderer,
        composer,
        bloomPass,
        bloomResolutionScale,
        smaaPass,
        controls,
        timer,
        controlPanel,
        solarRuntime,
        timeState,
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
        updateSpinUi,
        updateCaptionUi,
        updateDataRhythmUi,
        updateTerminatorGuideUi,
        updateIssLayerUi,
        updateZodiacalIntensityUi,
        updateAirglowUi,
        updateNoctilucentUi,
        updateDataSourceStatus,
        updateReelDurationUi,
        updateSocialPresetUi,
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
        startMoonEarthView,
        startMoonMarkerFocus,
        stopMoonMarkerFocus,
        startReturnFromMoon,
        updateFocus,
        updateMarkerAnimation,
        updateCameraControls,
        updateCameraDrift,
        surfaceVisualLock,
        setTerminatorGuideVisible,
        applyUrlFocus
    });

    // LOT 5: data layers follow the UTC day of the scene time (debounced, once
    // per day change); astronomy keeps following every change of time.
    const unsubscribeDataDay = timeState.subscribeDataDay(day => appRuntime.applyDataDay(day));
    // LOT 11: the scene hour of the loaded day drives wind / currents locally.
    const unsubscribeSceneTime = timeState.subscribe(snapshot => appRuntime.applySceneTime(snapshot));

    // LOT 23: the page's own runtime signals for earth-runtime-state.js (read-only snapshot).
    function runtimeSignals() {
        const layers = visualFoundation.getEarthLayerSignals?.() || {};
        const astronomy = getAstronomyImportState();
        const sunSource = solarRuntime?.solarState?.source;
        const eonet = atlasStatus.getSourceStatus('eonet');
        const sky = atlasStatus.getSourceStatus('realSky');
        const [usgsProvider, firmsProvider] = liveDataLayers.supplementalProviders || [];
        const registryLayer = (id) => {
            const entry = layerRegistry.entryState?.(id);
            return { id, enabled: Boolean(entry?.wanted), state: entry?.state || 'off' };
        };
        const providerLayer = (id, status) => ({ id, enabled: Boolean(status?.enabled), state: status?.state || 'off', errorKind: status?.errorKind || null });
        const iss = issSystem?.issState;
        return {
            relief: layers.relief || 'loading',
            surface: layers.surface || { kind: 'loading' },
            sun: sunSource === 'astronomy-engine' ? 'astronomy-engine'
                : !astronomy.loaded && !astronomy.loading && astronomy.error ? 'approx' : 'loading',
            eonet: { state: eonet?.state || null, phase: eonet?.phase || null, mode: state.dataSourceMode || 'eonet', activeProvider: dataSourceProvider },
            sky: sky?.phase === 'ready' ? sky.value : 'loading',
            nightLights: layers.nightLights || null,
            layers: [
                providerLayer('usgs', usgsProvider?.getStatus?.()),
                providerLayer('firms', firmsProvider?.getStatus?.()),
                providerLayer('wind', windParticles?.getStatus?.()),
                providerLayer('currents', oceanCurrents?.getStatus?.()),
                registryLayer('aurora'),
                registryLayer('gvp'),
                registryLayer('snowIce'),
                { id: 'iss', enabled: Boolean(iss?.enabled), state: iss?.enabled && iss.source === 'unavailable' ? 'error' : 'on' },
            ],
        };
    }

    let disposed = false;
    function dispose() {
        if (disposed) return;
        disposed = true;
        unsubscribeDataDay();
        unsubscribeSceneTime();
        setHimalayaSceneTimeProvider(null);
        eonetAutoRefresh.dispose();
        eonetApp.dispose?.();
        appRuntime.dispose();
        eventScene.dispose();
        liveDataLayers.dispose();
        layerRegistry.dispose?.();
        gdacsProvider.dispose?.();
        exportSystem.dispose?.();
        timeScrubPanel.dispose();
        visualFoundation.dispose();
        surfaceVisualLock.dispose?.();
    }

    return {
        appRuntime,
        eventScene,
        eonetApp,
        liveDataLayers,
        solarRuntime,
        timeState,
        moonSystem,
        moonMarkers,
        issSystem,
        airglowSystem,
        zodiacalLightSystem,
        noctilucentCloudSystem,
        windParticles,
        oceanCurrents,
        runtimeSignals,
        realSky: visualFoundation.realSky, // LOT 28: sky cost in the ?perf=1 run
        dispose
    };
}
