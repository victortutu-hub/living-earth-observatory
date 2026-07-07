export function createFrameRuntime({
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
    cloudFallbackTexture
}) {
    const sunDir = new THREE.Vector3();
    const cloudOverlayCrossfade = { active: false, start: 0, duration: 3.5 };

    function startCloudOverlayCrossfade(newTexture) {
        cloudOverlayMat.uniforms.uMapNew.value = newTexture;
        cloudOverlayCrossfade.start = getTime();
        cloudOverlayCrossfade.active = true;
    }

    function cancelCloudOverlayCrossfade() {
        cloudOverlayCrossfade.active = false;
        cloudOverlayMat.uniforms.uCrossfade.value = 0;
    }

    function updateCloudOverlayCrossfade(t) {
        if (!cloudOverlayCrossfade.active) return;
        const progress = Math.min(1, (t - cloudOverlayCrossfade.start) / cloudOverlayCrossfade.duration);
        cloudOverlayMat.uniforms.uCrossfade.value = progress;
        if (progress < 1) return;

        cloudOverlayMat.uniforms.uMap.value = cloudOverlayMat.uniforms.uMapNew.value;
        cloudOverlayMat.uniforms.uMapNew.value = cloudFallbackTexture;
        cloudOverlayMat.uniforms.uCrossfade.value = 0;
        cloudOverlayCrossfade.active = false;
    }

    function updateSunUniforms(t) {
        sunDir.copy(sunLight.position).normalize();
        cloudMat.uniforms.uTime.value = t;
        cloudMat.uniforms.uSunDir.value.copy(sunDir);
        cloudOverlayMat.uniforms.uTime.value = t;
        cloudOverlayMat.uniforms.uSunDir.value.copy(sunDir);
        nightLights.material.uniforms.uSunDir.value.copy(sunDir);
        atmosphereMat.uniforms.uSunDir.value.copy(sunDir);
        atmosphereMat.uniforms.uCamPos?.value?.copy(camera.position);
        earthMat.userData.shader?.uniforms.uSunDirTw?.value?.copy(sunDir);
        getEarthMatPBR?.()?.userData.shader?.uniforms.uSunDirTw?.value?.copy(sunDir);
    }

    function update(t) {
        clouds.rotation.y += 0.00018;
        realCloudOverlay.rotation.y = clouds.rotation.y;
        stars.rotation.y += 0.00008;
        updateSunUniforms(t);
        updateCloudOverlayCrossfade(t);
    }

    return {
        startCloudOverlayCrossfade,
        cancelCloudOverlayCrossfade,
        update
    };
}
