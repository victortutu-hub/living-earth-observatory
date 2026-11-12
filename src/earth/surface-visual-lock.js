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
    }),
    // The only case whose target is not the origin: the camera (3.6 units from
    // the centre, along the `global` direction) looks along a line that grazes
    // the Earth surface (closest approach 2.0), so the daylit limb crosses the
    // middle of the frame. Camera-target distance 3.2 stays above the
    // OrbitControls minDistance (3.1), so controls.update() does not move it.
    limb: Object.freeze({
        cameraPosition: [2.306, 2.548, -1.074], target: [-0.539, 1.921, 0.251],
        earthRotation: [0, 0, 0], iso: '2026-06-21T12:00:00.000Z'
    })
});

export const SURFACE_VISUAL_VIEWPORT = Object.freeze({ width: 1440, height: 900, dpr: 1 });

// The lock pins the GIBS albedo request to one size, so before/after captures
// never mix 8192 and 4096 textures (the live ladder may return either).
export const SURFACE_VISUAL_ALBEDO_SIZE = Object.freeze({ width: 4096, height: 2048 });

// Capture mode hides the UI panels (body children other than the WebGL canvas).
export const SURFACE_VISUAL_CAPTURE_CLASS = 'surface-visual-capture';
const CAPTURE_STYLE_ID = 'surfaceVisualCaptureStyle';
const CAPTURE_STYLE = `body.${SURFACE_VISUAL_CAPTURE_CLASS} > :not(canvas) { visibility: hidden !important; }`;

export function surfaceVisualCaseFromSearch(search = '') {
    const value = new URLSearchParams(search).get('surfaceVisualCase');
    return Object.hasOwn(SURFACE_VISUAL_CASES, value) ? value : null;
}

export function surfaceVisualMaterialFromSearch(search = '') {
    return new URLSearchParams(search).get('surfaceVisualMaterial') === 'pbr' ? 'pbr' : 'phong';
}

// A/B review overrides (LOT 4). Honoured only together with a valid
// surfaceVisualCase, so the normal app never reads them; invalid values are
// ignored (the production default stays in force).
const OVERRIDE_RANGES = Object.freeze({
    reliefExaggeration: [0, 100],
    reliefStrength: [0, 2],
    bathymetryMix: [0, 1],
});
const OVERRIDE_ENUMS = Object.freeze({
    coastNormals: ['clip'],
    surfaceDebug: ['tilt', 'tiltClipped', 'landWeight'],
});

export function surfaceVisualOverridesFromSearch(search = '') {
    if (!surfaceVisualCaseFromSearch(search)) return {};
    const params = new URLSearchParams(search);
    const overrides = {};
    for (const [key, [min, max]] of Object.entries(OVERRIDE_RANGES)) {
        const raw = params.get(key);
        if (raw === null || raw.trim() === '') continue;
        const value = Number(raw);
        if (Number.isFinite(value) && value >= min && value <= max) overrides[key] = value;
    }
    for (const [key, allowed] of Object.entries(OVERRIDE_ENUMS)) {
        const value = params.get(key);
        if (allowed.includes(value)) overrides[key] = value;
    }
    return overrides;
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
    if (!caseName) return Object.freeze({ active: false, apply: () => {}, enforce: () => {}, snapshot: () => null, dispose: () => {} });

    const preset = SURFACE_VISUAL_CASES[caseName];
    const materialPath = surfaceVisualMaterialFromSearch(search);
    const position = new THREE.Vector3(...preset.cameraPosition);
    const target = new THREE.Vector3(...preset.target);
    const rotation = new THREE.Euler(...preset.earthRotation);
    const fixedDate = new Date(preset.iso);

    // Owned by the lock: added in apply(), removed in dispose().
    function enterCaptureMode() {
        if (typeof document === 'undefined') return;
        if (!document.getElementById(CAPTURE_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = CAPTURE_STYLE_ID;
            style.textContent = CAPTURE_STYLE;
            document.head.appendChild(style);
        }
        document.body.classList.add(SURFACE_VISUAL_CAPTURE_CLASS);
    }

    function dispose() {
        if (typeof document === 'undefined') return;
        document.body.classList.remove(SURFACE_VISUAL_CAPTURE_CLASS);
        document.getElementById(CAPTURE_STYLE_ID)?.remove();
    }

    function apply() {
        enterCaptureMode();
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
            surfaceResolution: `${SURFACE_VISUAL_ALBEDO_SIZE.width}x${SURFACE_VISUAL_ALBEDO_SIZE.height} (pinned by the lock)`,
            nightLightsSource: 'stable bundled fallback',
            clouds: 'off',
            markers: 'off',
            ui: 'hidden (capture mode)',
            materialOverrides: surfaceVisualOverridesFromSearch(search),
            viewport: { ...SURFACE_VISUAL_VIEWPORT }
        });
    }

    return Object.freeze({ active: true, apply, enforce, snapshot, dispose, viewport: SURFACE_VISUAL_VIEWPORT });
}
