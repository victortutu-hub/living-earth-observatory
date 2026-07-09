import { createCloudSetup } from './cloud-setup.js?v=refraction1';
import { createSolarRuntime } from './solar-runtime.js?v=solarEngine2';
import { categoryColors, fallbackColor, futureDateToleranceMs } from './eonet-config.js?v=usgsIntegrated1';
import { createGeoUtils } from './geo.js';
import { createStarField } from './star-field.js?v=milkyWay1';
import { createEventUtils } from './event-utils.js?v=polyFix2';
import { createEarthLayers } from './earth-layers.js?v=refraction1';
import { createMoonSystem } from './moon-system.js?v=moonMarkers1';
import { createIssSystem } from './iss-system.js?v=issRobust1';
import { createAirglowSystem } from './airglow-system.js?v=airglow9';
import { createZodiacalLightSystem } from './zodiacal-light-system.js?v=zodiacal10';
import { createNoctilucentCloudSystem } from './noctilucent-cloud-system.js?v=noctilucent9';

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
        earthReliefNormal,
        earthReliefSeaLevel,
        earthReliefScale,
        sunLight
    } = bootstrap;

    const { lonLatToVec3 } = createGeoUtils(THREE);
    const eventUtils = createEventUtils({ THREE, categoryColors, fallbackColor, futureDateToleranceMs });

    const solarRuntime = createSolarRuntime({ THREE, scene, sunLight, lonLatToVec3 });
    const coolFill = solarRuntime.coolFill;
    const updateCoolFillDirection = solarRuntime.updateCoolFillDirection;
    solarRuntime.start();

    const moonSystem = createMoonSystem({ THREE, scene, sunLight, lonLatToVec3 });
    moonSystem.start();

    const issSystem = createIssSystem({ THREE, scene, lonLatToVec3 });
    issSystem.start();

    const earthLayers = createEarthLayers({
        THREE,
        earthGroup,
        earthMap,
        earthSpecular,
        earthLights,
        earthRelief,
        earthReliefNormal,
        earthReliefSeaLevel,
        earthReliefScale
    });
    const { earthMat, getEarthMatPBR, setMaterialMode, nightLights, atmosphereMat, applyAtmosphereMode: applyAtmosphereLayerMode } = earthLayers;

    const airglowSystem = createAirglowSystem({ THREE, earthGroup, sunLight });
    const zodiacalLightSystem = createZodiacalLightSystem({ THREE, scene, sunLight });
    const noctilucentCloudSystem = createNoctilucentCloudSystem({ THREE, earthGroup, sunLight });

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
        atmosphereMat,
        earthMat,
        getEarthMatPBR,
        getTime,
        applyNightLook
    });

    return {
        ...eventUtils,
        lonLatToVec3,
        solarRuntime,
        coolFill,
        updateCoolFillDirection,
        moonSystem,
        issSystem,
        airglowSystem,
        zodiacalLightSystem,
        noctilucentCloudSystem,
        earthMat,
        getEarthMatPBR,
        setMaterialMode,
        nightLights,
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
        }
    };
}
