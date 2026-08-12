import { createCloudSystem } from './cloud-system.js?v=dailyCloudsPaused7';
import { createCloudFallbackTexture, makeCloudMat } from './cloud-shaders.js?v=refraction1';
import { createFrameRuntime } from './frame-runtime.js?v=terminatorGuide1';

export function createCloudSetup({
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
    updateTerminatorGuide,
    getTime,
    applyNightLook
}) {
    const fallbackTexture = createCloudFallbackTexture(THREE);
    const cloudMat = makeCloudMat({ THREE, texture: earthClouds, opacity: 0.42, fallbackTexture });
    const cloudOverlayMat = makeCloudMat({ THREE, texture: fallbackTexture, opacity: 0, fallbackTexture });
    cloudOverlayMat.uniforms.uDriftScale.value = 0.22;
    cloudOverlayMat.uniforms.uMorphScale.value = 0.03;

    const clouds = new THREE.Mesh(new THREE.SphereGeometry(2.03, 160, 96), cloudMat);
    earthGroup.add(clouds);

    const realCloudOverlay = new THREE.Mesh(new THREE.SphereGeometry(2.038, 160, 96), cloudOverlayMat);
    realCloudOverlay.visible = false;
    earthGroup.add(realCloudOverlay);

    const frameRuntime = createFrameRuntime({
        THREE,
        getTime,
        camera,
        clouds,
        realCloudOverlay,
        stars,
        sunLight,
        cloudMat,
        cloudOverlayMat,
        nightLights,
        atmosphereMat,
        earthMat,
        getEarthMatPBR,
        updateTerminatorGuide,
        cloudFallbackTexture: fallbackTexture
    });

    const cloudSystem = createCloudSystem({
        THREE,
        renderer,
        state,
        cloudOverlayMat,
        realCloudOverlay,
        fallbackTexture,
        startCloudOverlayCrossfade: frameRuntime.startCloudOverlayCrossfade,
        applyNightLook
    });

    function disable() {
        frameRuntime.cancelCloudOverlayCrossfade();
        cloudSystem.disable();
    }

    return {
        cloudMat,
        cloudOverlayMat,
        clouds,
        realCloudOverlay,
        frameRuntime,
        enable: cloudSystem.enable,
        disable,
        updateButton: cloudSystem.updateButton
    };
}
