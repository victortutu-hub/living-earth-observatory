export const motionPresets = {
    slowOrbit: { autoRotateSpeed: 0.34, dampingFactor: 0.045, focusDuration: 1.45, cameraBobAmp: 0.0, cameraBobSpeed: 0.0 },
    heroDrift: { autoRotateSpeed: 0.22, dampingFactor: 0.06, focusDuration: 1.9, cameraBobAmp: 0.08, cameraBobSpeed: 0.34 },
    focusPulse: { autoRotateSpeed: 0.08, dampingFactor: 0.09, focusDuration: 3.1, cameraBobAmp: 0.025, cameraBobSpeed: 0.42 }
};

export const reelMoodPresets = {
    news: {
        spinFast: 4.2,
        snapDuration: 0.65,
        introEnd: 0.1,
        pulloutAt: 0.84,
        transitionLead: 0.02,
        captionTone: 'news',
        locatorOpacity: 0.22,
        markerPulseAmp: 0.8,
        bloomStrength: 0.32,
        bloomRadius: 0.62,
        bloomThreshold: 0.32,
        captionAccent: '#9fe7ff',
        captionStroke: 'rgba(130, 210, 255, 0.5)',
        captionWarmth: 'rgba(7, 14, 28, 0.84)',
        captionFillEnd: 'rgba(8, 20, 38, 0.64)'
    },
    cinematic: {
        spinFast: 6.0,
        snapDuration: 0.45,
        introEnd: 0.12,
        pulloutAt: 0.84,
        transitionLead: 0.035,
        captionTone: 'cinematic',
        locatorOpacity: 0.28,
        markerPulseAmp: 1,
        bloomStrength: 0.46,
        bloomRadius: 0.84,
        bloomThreshold: 0.24,
        captionAccent: '#ffd2a0',
        captionStroke: 'rgba(255, 190, 120, 0.62)',
        captionWarmth: 'rgba(18, 12, 22, 0.82)',
        captionFillEnd: 'rgba(10, 18, 34, 0.58)'
    },
    dramatic: {
        spinFast: 8.5,
        snapDuration: 0.28,
        introEnd: 0.16,
        pulloutAt: 0.88,
        transitionLead: 0.055,
        captionTone: 'dramatic',
        locatorOpacity: 0.38,
        markerPulseAmp: 1.25,
        bloomStrength: 0.62,
        bloomRadius: 1.02,
        bloomThreshold: 0.18,
        captionAccent: '#ff8f6b',
        captionStroke: 'rgba(255, 122, 76, 0.72)',
        captionWarmth: 'rgba(32, 10, 8, 0.84)',
        captionFillEnd: 'rgba(45, 12, 14, 0.62)'
    }
};

export const heroDriftProfiles = {
    default: { phaseSpeed: 0.32, targetBias: 0.18, targetPulse: 0.03, targetSide: 0.045, orbitAmp: 0.06, orbitPulse: 0.03, sideAmp: 0.055, verticalAmp: 0.018, targetLerp: 0.035 },
    wildfires: { phaseSpeed: 0.24, targetBias: 0.19, targetPulse: 0.026, targetSide: 0.032, orbitAmp: 0.05, orbitPulse: 0.025, sideAmp: 0.036, verticalAmp: 0.015, targetLerp: 0.03 },
    severeStorms: { phaseSpeed: 0.42, targetBias: 0.17, targetPulse: 0.038, targetSide: 0.072, orbitAmp: 0.055, orbitPulse: 0.04, sideAmp: 0.082, verticalAmp: 0.012, targetLerp: 0.045 },
    severeStorm: { phaseSpeed: 0.42, targetBias: 0.17, targetPulse: 0.038, targetSide: 0.072, orbitAmp: 0.055, orbitPulse: 0.04, sideAmp: 0.082, verticalAmp: 0.012, targetLerp: 0.045 },
    severestorms: { phaseSpeed: 0.42, targetBias: 0.17, targetPulse: 0.038, targetSide: 0.072, orbitAmp: 0.055, orbitPulse: 0.04, sideAmp: 0.082, verticalAmp: 0.012, targetLerp: 0.045 },
    severstorm: { phaseSpeed: 0.42, targetBias: 0.17, targetPulse: 0.038, targetSide: 0.072, orbitAmp: 0.055, orbitPulse: 0.04, sideAmp: 0.082, verticalAmp: 0.012, targetLerp: 0.045 },
    volcanoes: { phaseSpeed: 0.18, targetBias: 0.2, targetPulse: 0.018, targetSide: 0.022, orbitAmp: 0.04, orbitPulse: 0.018, sideAmp: 0.02, verticalAmp: 0.01, targetLerp: 0.026 }
};
