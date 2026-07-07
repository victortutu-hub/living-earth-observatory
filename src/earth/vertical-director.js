const verticalProfiles = {
    custom: {
        targetYOffset: -0.06,
        distanceScale: 1.25,
        captionYOffset: -0.5,
        captionHeightRatio: 0.135,
        locatorStartY: 0.34,
        locatorStartX: -1.08,
        bloomStrengthScale: 0.84,
        bloomRadiusScale: 0.92,
        bloomThresholdLift: 0.02
    },
    igCinematic: {
        targetYOffset: -0.04,
        distanceScale: 1.26,
        captionYOffset: -0.48,
        captionHeightRatio: 0.136,
        locatorStartY: 0.34,
        locatorStartX: -1.08,
        bloomStrengthScale: 0.82,
        bloomRadiusScale: 0.9,
        bloomThresholdLift: 0.025
    },
    tiktokImpact: {
        targetYOffset: -0.02,
        distanceScale: 1.22,
        captionYOffset: -0.42,
        captionHeightRatio: 0.13,
        locatorStartY: 0.38,
        locatorStartX: -1.02,
        bloomStrengthScale: 0.76,
        bloomRadiusScale: 0.84,
        bloomThresholdLift: 0.04
    },
    dramaticNature: {
        targetYOffset: -0.03,
        distanceScale: 1.24,
        captionYOffset: -0.45,
        captionHeightRatio: 0.132,
        locatorStartY: 0.36,
        locatorStartX: -1.06,
        bloomStrengthScale: 0.78,
        bloomRadiusScale: 0.88,
        bloomThresholdLift: 0.035
    },
    minimalPoetic: {
        targetYOffset: -0.08,
        distanceScale: 1.3,
        captionYOffset: -0.52,
        captionHeightRatio: 0.122,
        locatorStartY: 0.32,
        locatorStartX: -1.0,
        bloomStrengthScale: 0.68,
        bloomRadiusScale: 0.82,
        bloomThresholdLift: 0.045
    }
};

function activeProfileName(state) {
    return verticalProfiles[state?.socialPreset] ? state.socialPreset : 'custom';
}

export function isVerticalDirectorActive(state, aspect) {
    return Boolean(state?.verticalDirector) && aspect < 1;
}

export function getVerticalDirectorProfile(state, aspect) {
    if (!isVerticalDirectorActive(state, aspect)) return null;
    return verticalProfiles[activeProfileName(state)] || verticalProfiles.custom;
}

export function applyVerticalDirectorCameraFraming({ THREE, state, exportCamera, controls, exportAspect }) {
    const profile = getVerticalDirectorProfile(state, exportAspect);
    if (!profile) return false;

    const baseTarget = controls.target.clone();
    const offset = exportCamera.position.clone().sub(baseTarget);
    const portraitTarget = baseTarget.clone().add(new THREE.Vector3(0, profile.targetYOffset, 0));
    const portraitDistance = offset.length() * profile.distanceScale;
    exportCamera.position.copy(portraitTarget.clone().add(offset.normalize().multiplyScalar(portraitDistance)));
    exportCamera.lookAt(portraitTarget);
    return true;
}

export function getVerticalCaptionLayout(state, aspect) {
    const profile = getVerticalDirectorProfile(state, aspect);
    if (!profile) return null;
    return {
        verticalOffset: profile.captionYOffset,
        heightRatio: profile.captionHeightRatio,
        locatorStartY: profile.locatorStartY,
        locatorStartX: profile.locatorStartX
    };
}

export function getVerticalBloomParams(state, aspect, bloomPass) {
    const profile = getVerticalDirectorProfile(state, aspect);
    if (!profile) {
        return {
            strength: bloomPass.strength,
            radius: bloomPass.radius,
            threshold: bloomPass.threshold
        };
    }
    return {
        strength: bloomPass.strength * profile.bloomStrengthScale,
        radius: bloomPass.radius * profile.bloomRadiusScale,
        threshold: Math.min(1, bloomPass.threshold + profile.bloomThresholdLift)
    };
}
