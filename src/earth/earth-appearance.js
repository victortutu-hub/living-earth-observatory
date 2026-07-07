import { applyEarthLookUniforms, earthLookPresets } from './earth-look.js?v=pbrRoughness1';

export function createEarthAppearance({
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
}) {
    function applyNightLook(enabled) {
        state.night = enabled;
        const earthLook = earthLookPresets[state.earthLook] || earthLookPresets.cinematic;
        nightLights.material.uniforms.uOpacity.value = state.night ? earthLook.cityOpacityNight : earthLook.cityOpacityDay;
        cloudMat.uniforms.uOpacity.value = state.realClouds ? 0 : (state.night ? 0.4 : 0.5);
        cloudOverlayMat.uniforms.uOpacity.value = state.realClouds ? (state.night ? 0.34 : 0.42) : 0;
        scene.fog.density = state.night ? 0.028 : 0.018;
        renderer.setClearColor(state.night ? 0x02050d : 0x07101c, 0);
    }

    function applyEarthLook(name) {
        applyEarthLookUniforms({
            name,
            state,
            earthMat,
            getEarthMatPBR,
            nightLights,
            cloudMat,
            cloudOverlayMat,
            atmosphereMat,
            coolFill
        });
        applyNightLook(state.night);
        updateCoolFillDirection();
    }

    // V3.2 - comuta materialul Pamantului intre Phong (V1, cu Fresnel oceane
    // V3.1) si PBR (MeshStandardMaterial, roughness/metalness per tip de
    // suprafata). Fresnel-ul din V3.1 ramane doar pe varianta Phong - PBR-ul
    // isi produce propriile reflexii fizice corecte prin Cook-Torrance/GGX,
    // fara sa mai fie nevoie de acel hack.
    function applyMaterialMode(mode) {
        state.materialMode = mode === 'pbr' ? 'pbr' : 'phong';
        setMaterialMode(state.materialMode);
        const button = document.getElementById('materialModeBtn');
        if (button) {
            button.textContent = state.materialMode === 'pbr'
                ? 'Surface: PBR roughness'
                : 'Surface: Phong (default)';
        }
        applyEarthLook(state.earthLook);
    }

    function applyAtmosphereMode(mode) {
        state.atmosphereMode = mode === 'physical' ? 'physical' : 'simple';
        applyAtmosphereLayerMode(state.atmosphereMode);
        const button = document.getElementById('atmosphereModeBtn');
        if (button) {
            button.textContent = state.atmosphereMode === 'physical'
                ? 'Atmosphere: physical'
                : 'Atmosphere: dot';
        }
    }

    function applyOceanFresnel(enabled) {
        state.oceanFresnel = Boolean(enabled);
        const shader = earthMat.userData.shader;
        if (shader?.uniforms?.uFresnelEnabledTw) {
            shader.uniforms.uFresnelEnabledTw.value = state.oceanFresnel ? 1.0 : 0.0;
        }
        const button = document.getElementById('oceanFresnelBtn');
        if (button) button.textContent = `Fresnel oceans: ${state.oceanFresnel ? 'on' : 'off'}`;
    }

    // V3.6 - SSS pe gheata/zapada, disponibil pe ambele materiale (Phong si PBR).
    function applySSSIce(enabled) {
        state.sssIce = Boolean(enabled);
        for (const mat of [earthMat, getEarthMatPBR?.()]) {
            const shader = mat?.userData.shader;
            if (shader?.uniforms?.uSSSEnabledTw) {
                shader.uniforms.uSSSEnabledTw.value = state.sssIce ? 1.0 : 0.0;
            }
        }
        const button = document.getElementById('sssIceBtn');
        if (button) button.textContent = `SSS ice: ${state.sssIce ? 'on' : 'off'}`;
    }

    function applyReelMood(name) {
        state.reelMood = reelMoodPresets[name] ? name : 'cinematic';
        const mood = currentReelMood();
        state.spinFast = mood.spinFast;
        state.snapDuration = mood.snapDuration;
        renderer.toneMappingExposure = state.brandPreset
            ? (state.reelMood === 'dramatic' ? 1.16 : state.reelMood === 'news' ? 1.04 : 1.1)
            : lookDefaults.toneExposure;
        bloomPass.strength = mood.bloomStrength;
        bloomPass.radius = mood.bloomRadius;
        bloomPass.threshold = mood.bloomThreshold;
        updateSpinUi();
        updateReelMoodUi();
    }

    function applyBrandPreset(enabled) {
        state.brandPreset = enabled;
        state.captureMode = enabled;
        updateCaptureMode();
        applyNightLook(true);
        renderer.toneMappingExposure = enabled ? 1.1 : lookDefaults.toneExposure;
        if (enabled) {
            const mood = currentReelMood();
            bloomPass.strength = mood.bloomStrength;
            bloomPass.radius = mood.bloomRadius;
            bloomPass.threshold = mood.bloomThreshold;
        } else {
            bloomPass.strength = lookDefaults.bloomStrength;
            bloomPass.radius = lookDefaults.bloomRadius;
            bloomPass.threshold = lookDefaults.bloomThreshold;
        }
        applyMotionPreset(state.motionPreset);
        updateBrandPreset();
    }

    return {
        applyNightLook,
        applyEarthLook,
        applyAtmosphereMode,
        applyOceanFresnel,
        applySSSIce,
        applyMaterialMode,
        applyReelMood,
        applyBrandPreset
    };
}
