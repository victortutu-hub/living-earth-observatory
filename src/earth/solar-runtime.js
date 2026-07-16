import { createSolarSystem } from './solar-system.js?v=unifiedEarthLot2';

export function createSolarRuntime({
    THREE,
    scene,
    sunLight,
    lonLatToVec3,
    getDate = () => new Date(),
    refreshMs = 30000
}) {
    const solarSystem = createSolarSystem({ THREE, scene, sunLight, lonLatToVec3, getDate });
    let intervalId = null;

    function start() {
        solarSystem.updateRealSunPosition();
        if (intervalId !== null) return;
        intervalId = setInterval(solarSystem.updateRealSunPosition, refreshMs);
    }

    function stop() {
        if (intervalId === null) return;
        clearInterval(intervalId);
        intervalId = null;
    }

    return {
        coolFill: solarSystem.coolFill,
        solarState: solarSystem.solarState,
        start,
        stop,
        updateRealSunPosition: solarSystem.updateRealSunPosition,
        updateCoolFillDirection: solarSystem.updateCoolFillDirection
    };
}
