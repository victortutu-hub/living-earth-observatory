export const socialPresets = {
    custom: {
        label: 'Custom'
    },
    igCinematic: {
        label: 'IG Cinematic',
        reelDurationSec: 24,
        reelMood: 'cinematic',
        earthLook: 'showcase',
        atmosphereMode: 'physical',
        motionPreset: 'slowOrbit',
        guide916: true,
        verticalDirector: true,
        captionStyle: 'cinematic',
        poeticCaptions: false,
        dataRhythm: true,
        brandPreset: false
    },
    tiktokImpact: {
        label: 'TikTok Impact',
        reelDurationSec: 18,
        reelMood: 'dramatic',
        earthLook: 'showcase',
        atmosphereMode: 'physical',
        motionPreset: 'heroDrift',
        guide916: true,
        verticalDirector: true,
        captionStyle: 'impact',
        poeticCaptions: false,
        dataRhythm: true,
        brandPreset: false
    },
    dramaticNature: {
        label: 'Dramatic Nature',
        reelDurationSec: 22,
        reelMood: 'dramatic',
        earthLook: 'showcase',
        atmosphereMode: 'physical',
        motionPreset: 'heroDrift',
        guide916: true,
        verticalDirector: true,
        captionStyle: 'impact',
        poeticCaptions: false,
        dataRhythm: true,
        brandPreset: false
    },
    minimalPoetic: {
        label: 'Minimal Poetic',
        reelDurationSec: 20,
        reelMood: 'news',
        earthLook: 'scientific',
        atmosphereMode: 'physical',
        motionPreset: 'focusPulse',
        guide916: true,
        verticalDirector: true,
        captionStyle: 'minimal',
        poeticCaptions: true,
        dataRhythm: true,
        brandPreset: false
    },
    quietPower: {
        label: 'Quiet Power',
        reelDurationSec: 26,
        reelMood: 'cinematic',
        earthLook: 'showcase',
        atmosphereMode: 'physical',
        motionPreset: 'slowOrbit',
        guide916: true,
        verticalDirector: true,
        captionStyle: 'minimal',
        poeticCaptions: true,
        dataRhythm: true,
        brandPreset: false
    },
    dataAsLight: {
        label: 'Data as Light',
        reelDurationSec: 24,
        reelMood: 'cinematic',
        earthLook: 'showcase',
        atmosphereMode: 'physical',
        motionPreset: 'slowOrbit',
        guide916: true,
        verticalDirector: true,
        captionStyle: 'cinematic',
        poeticCaptions: true,
        dataRhythm: true,
        brandPreset: false
    },
    orbitalStory: {
        label: 'Orbital Story',
        reelDurationSec: 34,
        reelMood: 'cinematic',
        earthLook: 'showcase',
        atmosphereMode: 'physical',
        motionPreset: 'slowOrbit',
        guide916: true,
        verticalDirector: true,
        captionStyle: 'cinematic',
        poeticCaptions: true,
        dataRhythm: true,
        brandPreset: false,
        includeIssBeat: true
    }
};

export function normalizeSocialPresetName(name) {
    return socialPresets[name] ? name : 'custom';
}

export function createSocialPresetSystem({
    state,
    updateSocialPresetUi,
    updateReelDurationUi,
    updateVerticalDirectorUi,
    updateCaptionUi,
    updateDataRhythmUi,
    updateGuide916,
    fitGlobeTo916,
    applyMotionPreset,
    applyReelMood,
    applyEarthLook,
    applyAtmosphereMode,
    applyBrandPreset
}) {
    function setCustom() {
        state.socialPreset = 'custom';
        updateSocialPresetUi?.();
    }

    function applySocialPreset(name) {
        const presetName = normalizeSocialPresetName(name);
        const preset = socialPresets[presetName];
        state.socialPreset = presetName;
        updateSocialPresetUi?.();

        if (presetName === 'custom') return preset;

        state.verticalDirector = preset.verticalDirector;
        updateVerticalDirectorUi?.();
        state.captionStyle = preset.captionStyle;
        state.poeticCaptions = Boolean(preset.poeticCaptions);
        updateCaptionUi?.();
        state.dataRhythm = Boolean(preset.dataRhythm);
        updateDataRhythmUi?.();
        state.includeIssBeat = Boolean(preset.includeIssBeat);

        state.reelDurationSec = preset.reelDurationSec;
        updateReelDurationUi?.();

        applyReelMood?.(preset.reelMood);
        applyEarthLook?.(preset.earthLook);
        applyAtmosphereMode?.(preset.atmosphereMode);
        applyMotionPreset?.(preset.motionPreset);
        applyBrandPreset?.(preset.brandPreset);

        if (state.guide916 !== preset.guide916) {
            state.guide916 = preset.guide916;
            updateGuide916?.();
        }
        if (preset.guide916) fitGlobeTo916?.();

        return preset;
    }

    return {
        applySocialPreset,
        setCustom,
        socialPresets
    };
}
