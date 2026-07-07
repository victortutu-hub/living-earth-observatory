export const earthLookPresets = {
    scientific: {
        earthNight: 0.82,
        earthTwilight: 0.12,
        cityOpacityNight: 0.32,
        cityOpacityDay: 0.10,
        cityIntensity: 1.0,
        cityTwilight: 0.06,
        cloudNight: 0.34,
        cloudTwilight: 0.10,
        atmosphereAlpha: 0.72,
        sunsetAlpha: 0.72,
        nightRim: 0.50,
        coolFillIntensity: 0.10
    },
    cinematic: {
        earthNight: 1.0,
        earthTwilight: 0.22,
        cityOpacityNight: 0.44,
        cityOpacityDay: 0.18,
        cityIntensity: 1.0,
        cityTwilight: 0.10,
        cloudNight: 0.46,
        cloudTwilight: 0.24,
        atmosphereAlpha: 1.0,
        sunsetAlpha: 1.0,
        nightRim: 1.0,
        coolFillIntensity: 0.28
    },
    showcase: {
        earthNight: 1.16,
        earthTwilight: 0.34,
        cityOpacityNight: 0.58,
        cityOpacityDay: 0.24,
        cityIntensity: 1.22,
        cityTwilight: 0.18,
        cloudNight: 0.58,
        cloudTwilight: 0.36,
        atmosphereAlpha: 1.24,
        sunsetAlpha: 1.32,
        nightRim: 1.35,
        coolFillIntensity: 0.46
    }
};

export function applyEarthLookUniforms({
    name,
    state,
    earthMat,
    getEarthMatPBR,
    nightLights,
    cloudMat,
    cloudOverlayMat,
    atmosphereMat,
    coolFill,
    selectId = 'earthLook'
}) {
    state.earthLook = earthLookPresets[name] ? name : 'cinematic';
    const preset = earthLookPresets[state.earthLook];
    const select = document.getElementById(selectId);
    if (select) select.value = state.earthLook;

    for (const mat of [earthMat, getEarthMatPBR?.()]) {
        if (mat?.userData.shader) {
            mat.userData.shader.uniforms.uEarthNightTw.value = preset.earthNight;
            mat.userData.shader.uniforms.uEarthTwilightTw.value = preset.earthTwilight;
        }
    }
    nightLights.material.uniforms.uCityIntensity.value = preset.cityIntensity;
    nightLights.material.uniforms.uCityTwilight.value = preset.cityTwilight;
    cloudMat.uniforms.uCloudNight.value = preset.cloudNight;
    cloudMat.uniforms.uCloudTwilight.value = preset.cloudTwilight;
    cloudOverlayMat.uniforms.uCloudNight.value = preset.cloudNight;
    cloudOverlayMat.uniforms.uCloudTwilight.value = preset.cloudTwilight;
    atmosphereMat.uniforms.uAtmosphereAlpha.value = preset.atmosphereAlpha;
    atmosphereMat.uniforms.uSunsetAlpha.value = preset.sunsetAlpha;
    atmosphereMat.uniforms.uNightRim.value = preset.nightRim;
    coolFill.intensity = preset.coolFillIntensity;

    return preset;
}
