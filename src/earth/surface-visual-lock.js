// Narrow development-only capture lock for Sprint 2.4B material calibration.
// It deliberately reuses the live scene objects; it is not a generic recorder.
export const SURFACE_VISUAL_CASES = Object.freeze({
    global: Object.freeze({
        cameraPosition: [4.10, 4.53, -1.91], target: [0, 0, 0],
        earthRotation: [0, 0, 0], iso: '2026-06-21T12:00:00.000Z'
    }),
    continental: Object.freeze({
        cameraPosition: [3.40, 3.75, -1.58], target: [0, 0, 0],
        earthRotation: [0, 0, 0], iso: '2026-06-21T12:00:00.000Z'
    }),
    regional: Object.freeze({
        cameraPosition: [2.56, 2.83, -1.20], target: [0, 0, 0],
        earthRotation: [0, 0, 0], iso: '2026-06-21T12:00:00.000Z'
    }),
    close: Object.freeze({
        cameraPosition: [1.99, 2.19, -0.93], target: [0, 0, 0],
        earthRotation: [0, 0, 0], iso: '2026-06-21T12:00:00.000Z'
    }),
    terminator: Object.freeze({
        cameraPosition: [2.56, 2.83, -1.20], target: [0, 0, 0],
        earthRotation: [0, 1.5707963267948966, 0], iso: '2026-06-21T00:00:00.000Z'
    }),
    night: Object.freeze({
        cameraPosition: [2.56, 2.83, -1.20], target: [0, 0, 0],
        earthRotation: [0, 3.141592653589793, 0], iso: '2026-06-21T00:00:00.000Z'
    }),
    polar: Object.freeze({
        cameraPosition: [0.25, 3.88, -0.18], target: [0, 0, 0],
        earthRotation: [0, 0, 0], iso: '2026-06-21T12:00:00.000Z'
    }),
    antimeridian: Object.freeze({
        cameraPosition: [-3.15, 2.32, 0.12], target: [0, 0, 0],
        earthRotation: [0, 0, 0], iso: '2026-06-21T12:00:00.000Z'
    })
});

export const SURFACE_VISUAL_VIEWPORT = Object.freeze({ width: 1440, height: 900, dpr: 1 });

export function surfaceVisualCaseFromSearch(search = '') {
    const value = new URLSearchParams(search).get('surfaceVisualCase');
    return Object.hasOwn(SURFACE_VISUAL_CASES, value) ? value : null;
}

export function surfaceVisualMaterialFromSearch(search = '') {
    return new URLSearchParams(search).get('surfaceVisualMaterial') === 'pbr' ? 'pbr' : 'phong';
}

export function surfaceVisualMaterialDebugFromSearch(search = '') {
    return new URLSearchParams(search).get('surfaceMaterialDebug') === '1';
}

export function createSurfaceVisualLock({
    THREE, camera, controls, earthGroup, markerGroup, trailGroup, cloudMat,
    cloudOverlayMat, timeState, solarRuntime, moonSystem, issSystem,
    applyMaterialMode, search = window.location.search
}) {
    const caseName = surfaceVisualCaseFromSearch(search);
    if (!caseName) return Object.freeze({ active: false, apply: () => {}, enforce: () => {}, snapshot: () => null });

    const preset = SURFACE_VISUAL_CASES[caseName];
    const materialPath = surfaceVisualMaterialFromSearch(search);
    const position = new THREE.Vector3(...preset.cameraPosition);
    const target = new THREE.Vector3(...preset.target);
    const rotation = new THREE.Euler(...preset.earthRotation);
    const fixedDate = new Date(preset.iso);

    function apply() {
        controls.autoRotate = false;
        controls.enableDamping = false;
        timeState.setHistoricalTime(fixedDate);
        solarRuntime.stop?.();
        solarRuntime.updateRealSunPosition?.();
        moonSystem.stop?.();
        issSystem.stop?.();
        applyMaterialMode?.(materialPath);
        enforce();
    }

    function enforce() {
        camera.position.copy(position);
        controls.target.copy(target);
        camera.lookAt(target);
        controls.autoRotate = false;
        earthGroup.rotation.copy(rotation);
        markerGroup.visible = false;
        trailGroup.visible = false;
        cloudMat.uniforms.uOpacity.value = 0;
        cloudOverlayMat.uniforms.uOpacity.value = 0;
        controls.update();
    }

    function snapshot() {
        return Object.freeze({
            caseName,
            cameraPosition: [...preset.cameraPosition],
            cameraTarget: [...preset.target],
            cameraDistance: position.distanceTo(target),
            earthRotation: [...preset.earthRotation],
            time: preset.iso,
            materialPath,
            surfaceSource: 'current runtime surface texture (no lock override)',
            surfaceResolution: 'runtime-provided',
            nightLightsSource: 'stable bundled fallback',
            clouds: 'off',
            markers: 'off',
            viewport: { ...SURFACE_VISUAL_VIEWPORT }
        });
    }

    return Object.freeze({ active: true, apply, enforce, snapshot, viewport: SURFACE_VISUAL_VIEWPORT });
}
