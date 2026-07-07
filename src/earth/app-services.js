import { createEarthAppearance } from './earth-appearance.js?v=v3sss1';
import { heroDriftProfiles, motionPresets, reelMoodPresets } from './reel-presets.js';
import { EONET_API, officialCategories, officialCategoryLabels } from './eonet-config.js?v=usgsIntegrated1';
import { createGdacsProvider } from './gdacs-provider.js?v=gdacs3';
import { createReelOverlay } from './reel-overlay.js?v=ffmpegExport1';
import { editorialSelection } from './reel-timeline.js?v=ffmpegExport1';
import { createExportSystem } from './export-system.js?v=ffmpegExport1';
import { createControlPanel } from './control-panel.js?v=v3sss1';
import { createEonetAutoRefreshController } from './eonet-data.js?v=multiSource2';
import { createEonetApp } from './eonet-app.js?v=markerPicking1';
import { createCameraMotionRuntime } from './camera-motion.js?v=moonMarkers1';
import { createEarthAppRuntime } from './app-runtime.js?v=v3sss1';
import { createLiveDataLayers } from './live-data-layers.js?v=markerPicking1';
import { lookDefaults } from './app-state.js?v=v3sss1';
import { createEventScene } from './event-scene.js?v=markerPicking1';
import { createAppVisualFoundation } from './app-visual-foundation.js?v=v3sss1';
import { createDataRhythmCamera } from './data-rhythm-camera.js';
import { createMoonMarkers } from './moon-markers.js?v=moonMarkers1';
import { localDirForSelenographic } from './moon-system.js?v=moonMarkers1';

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
        smaaPass
    } = sceneRuntime;
    const clock = new THREE.Clock();
    const visualFoundation = createAppVisualFoundation({
        THREE,
        state,
        sceneRuntime,
        bootstrap,
        getTime: () => clock.getElapsedTime()
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
        moonSystem,
        issSystem,
        airglowSystem,
        zodiacalLightSystem,
        noctilucentCloudSystem,
        coolFill,
        updateCoolFillDirection,
        earthMat,
        getEarthMatPBR,
        setMaterialMode,
        nightLights,
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
        getTime: () => clock.getElapsedTime(),
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
        updateMarkerAnimation
    } = eventScene;

    const moonMarkers = createMoonMarkers({
        THREE,
        moon: moonSystem.moon,
        localDirForSelenographic
    });

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
        updateEonetRefreshStatus,
        updateDataSourceStatus,
        updateSeismicLayerStatus,
        updateFirmsLayerStatus,
        updateAuroraLayerStatus,
        updateIssLayerUi,
        updateMoonTextureUi,
        updateZodiacalIntensityUi,
        updateAirglowUi,
        updateNoctilucentUi
    } = controlPanel;

    const liveDataLayers = createLiveDataLayers({
        THREE,
        state,
        earthGroup,
        lonLatToVec3,
        updateSeismicLayerStatus,
        updateFirmsLayerStatus,
        updateAuroraLayerStatus
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
        getTime: () => clock.getElapsedTime(),
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
        getTime: () => clock.getElapsedTime(),
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

    const dataRhythmCamera = createDataRhythmCamera({
        state,
        eventRecency,
        eventMagnitudeScale
    });

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
            state.dataSourceState = status.state || 'off';
            state.dataSourceMessage = status.message || 'Data source: NASA EONET default';
            updateDataSourceStatus?.(status);
        },
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
            { label: 'Phase', value: Number.isFinite(m.phaseFraction) ? `${Math.round(m.phaseFraction * 100)}% lit` : 'unknown' },
            { label: 'Distance', value: Number.isFinite(m.distanceKm) ? `${Math.round(m.distanceKm).toLocaleString()} km` : 'unknown' },
            { label: 'Sublunar point', value: `${m.sublunarLat.toFixed(2)} lat, ${m.sublunarLon.toFixed(2)} lon` },
            { label: 'Libration', value: Number.isFinite(m.librationElon) ? `${m.librationElon.toFixed(2)}° lon, ${m.librationElat.toFixed(2)}° lat` : 'unknown' },
            { label: 'Illumination', value: 'Real Sun direction (MeshLambertMaterial), same sunLight as Earth' },
            { label: 'Texture', value: m.textureSource === 'nasa' ? 'NASA LROC WAC (public domain)' : 'CoryG89 mosaic (default)' },
            { label: 'Source', value: m.source || 'unknown' }
        ]);
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
        updateSpinUi,
        updateCaptionUi,
        updateDataRhythmUi,
        updateIssLayerUi,
        updateMoonTextureUi,
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
        startMoonMarkerFocus,
        stopMoonMarkerFocus,
        startReturnFromMoon,
        updateFocus,
        updateMarkerAnimation,
        updateCameraControls,
        updateCameraDrift
    });

    return {
        appRuntime,
        eventScene,
        eonetApp,
        liveDataLayers,
        solarRuntime,
        moonSystem,
        moonMarkers,
        issSystem,
        airglowSystem,
        zodiacalLightSystem,
        noctilucentCloudSystem
    };
}
