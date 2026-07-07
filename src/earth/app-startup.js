export function createAppStartup({
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
    animate
}) {
    function start() {
        const loadPromise = loadEvents();
        updateCaptureMode();
        updateBrandPreset();
        updateGuide916();
        updateVerticalDirectorUi?.();
        updateCaptionUi?.();
        updateDataRhythmUi?.();
        updateReelDurationUi();
        updateSocialPresetUi?.();
        updateReelVideoButton();
        applyMotionPreset(state.motionPreset);
        applyEarthLook(state.earthLook);
        applyAtmosphereMode(state.atmosphereMode);
        animate();
        return loadPromise;
    }

    return { start };
}
