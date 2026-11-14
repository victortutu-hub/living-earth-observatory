import { createCloudSetup } from './cloud-setup.js';
import { createSolarRuntime } from './solar-runtime.js';
import { categoryColors, fallbackColor, futureDateToleranceMs } from './eonet-config.js';
import { createGeoUtils } from './geo.js';
import { createStarField } from './star-field.js';
import { createEventUtils } from './event-utils.js';
import { createEarthLayers } from './earth-layers.js';
import { createMoonSystem } from './moon-system.js';
import { createIssSystem } from './iss-system.js';
import { createEarthTimeState } from './earth-time-state.js';
import { createAirglowSystem } from './airglow-system.js';
import { createZodiacalLightSystem } from './zodiacal-light-system.js';
import { createNoctilucentCloudSystem } from './noctilucent-cloud-system.js';
import { createWindParticles } from './wind-particles.js';
import { createOceanCurrents } from './ocean-currents.js';

export function createAppVisualFoundation({
    THREE,
    state,
    sceneRuntime,
    bootstrap,
    getTime
}) {
    const {
        scene,
        camera,
        renderer,
        earthGroup
    } = sceneRuntime;
    const {
        earthMap,
        earthSpecular,
        earthClouds,
        earthLights,
        earthRelief,
        earthWaterMask,
        sunLight
    } = bootstrap;

    const { lonLatToVec3 } = createGeoUtils(THREE);
    const timeState = createEarthTimeState();
    // Event recency is relative to the end of the chosen UTC day in the past.
    const timeReference = () => {
        const day = timeState.dataDay();
        return day ? { nowMs: Date.parse(`${day}T23:59:59.999Z`), historical: true } : { nowMs: Date.now(), historical: false };
    };
    const eventUtils = createEventUtils({ THREE, categoryColors, fallbackColor, futureDateToleranceMs, timeReference });

    const getDate = () => timeState.now();
    const solarRuntime = createSolarRuntime({ THREE, scene, sunLight, lonLatToVec3, getDate });
    const coolFill = solarRuntime.coolFill;
    const updateCoolFillDirection = solarRuntime.updateCoolFillDirection;
    solarRuntime.start();

    const moonSystem = createMoonSystem({ THREE, scene, sunLight, lonLatToVec3, getDate });
    moonSystem.start();

    const issSystem = createIssSystem({ THREE, scene, lonLatToVec3, getDate });
    issSystem.start();

    const unsubscribeTimeState = timeState.subscribe(({ date }) => {
        solarRuntime.updateRealSunPosition();
        moonSystem.updateMoonPosition(date);
    });

    const earthLayers = createEarthLayers({
        THREE,
        renderer,
        earthGroup,
        earthMap,
        earthSpecular,
        earthLights,
        earthRelief,
        earthWaterMask
    });
    const {
        earthMat,
        getEarthMatPBR,
        setMaterialMode,
        setSurfaceMaterialResponseEnabled,
        getSurfaceMaterialDebugSnapshot,
        surfaceReady,
        nightLights,
        setNightLightsStatusListener,
        setSurfaceStatusListener,
        updateTerminatorGuide,
        setTerminatorGuideVisible,
        atmosphereMat,
        applyAtmosphereMode: applyAtmosphereLayerMode
    } = earthLayers;

    const airglowSystem = createAirglowSystem({ THREE, earthGroup, sunLight });
    const zodiacalLightSystem = createZodiacalLightSystem({ THREE, scene, sunLight });
    const noctilucentCloudSystem = createNoctilucentCloudSystem({ THREE, earthGroup, sunLight });
    const windParticles = createWindParticles({ THREE, renderer, earthGroup });
    const oceanCurrents = createOceanCurrents({ THREE, renderer, earthGroup });

    const stars = createStarField(THREE);
    scene.add(stars);

    let applyNightLookHandler = () => {};
    function applyNightLook(enabled) {
        applyNightLookHandler(enabled);
    }

    const cloudSetup = createCloudSetup({
        THREE,
        renderer,
        state,
        earthGroup,
        earthClouds,
        camera,
        stars,
        sunLight,
        nightLights,
        setNightLightsStatusListener,
        atmosphereMat,
        earthMat,
        getEarthMatPBR,
        updateTerminatorGuide,
        getTime,
        applyNightLook
    });

    let disposed = false;
    function dispose() {
        if (disposed) return;
        disposed = true;
        unsubscribeTimeState();
        solarRuntime.stop();
        moonSystem.stop();
        issSystem.stop();
        cloudSetup.disable?.();
        windParticles.dispose();
        oceanCurrents.dispose();
    }

    return {
        ...eventUtils,
        lonLatToVec3,
        solarRuntime,
        timeState,
        coolFill,
        updateCoolFillDirection,
        moonSystem,
        issSystem,
        airglowSystem,
        zodiacalLightSystem,
        noctilucentCloudSystem,
        windParticles,
        oceanCurrents,
        earthMat,
        getEarthMatPBR,
        setMaterialMode,
        setSurfaceMaterialResponseEnabled,
        getSurfaceMaterialDebugSnapshot,
        surfaceReady,
        nightLights,
        setNightLightsStatusListener,
        setSurfaceStatusListener,
        setTerminatorGuideVisible,
        atmosphereMat,
        applyAtmosphereLayerMode,
        cloudMat: cloudSetup.cloudMat,
        cloudOverlayMat: cloudSetup.cloudOverlayMat,
        frameRuntime: cloudSetup.frameRuntime,
        enableRealClouds: cloudSetup.enable,
        disableRealClouds: cloudSetup.disable,
        applyNightLook,
        setApplyNightLookHandler(handler) {
            applyNightLookHandler = handler;
        },
        dispose
    };
}
