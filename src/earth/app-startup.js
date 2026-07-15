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
    startAnimation
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
        startAnimation();
        return loadPromise;
    }

    return { start };
}
