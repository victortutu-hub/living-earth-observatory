// Sprint 2.4B: this is an interpretive material response, not geography.
// Blue Marble/GIBS and ETOPO remain the observed / observed-derived signals.
export const SURFACE_MATERIAL_REPRESENTATION = Object.freeze({
    observed: 'Blue Marble / GIBS surface imagery',
    observedDerived: 'ETOPO relief and normal',
    interpretive: 'Interpretive distance-gated meso roughness/specular material response'
});

export const SURFACE_MATERIAL_DEBUG_MODES = Object.freeze({
    off: 'off',
    on: 'on'
});

// All distances are camera-to-Earth-centre multiples. The live Earth radius is
// 2, with a practical camera range of about 3.1 to 12 and an initial view 6.4.
export const SURFACE_MATERIAL_LOD = Object.freeze({
    mesoFullRadiusMultiplier: 2.35,
    mesoFadeOutRadiusMultiplier: 3.00
});

export const SURFACE_MATERIAL_RESPONSE = Object.freeze({
    coastStartReliefOffset: 0.004,
    coastEndReliefOffset: 0.026,
    mesoFrequency: 7.0,
    // PBR stays within a natural-material range. The Phong value is only a
    // perceptual specular equivalent; it is not a physical roughness claim.
    pbrRoughnessAmplitude: 0.085,
    pbrRoughnessMin: 0.18,
    pbrRoughnessMax: 0.92,
    phongSpecularAmplitude: 0.14
});

export function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value < edge0 ? 0 : 1;
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

export function surfaceMaterialDebugModeFromSearch(search = '') {
    const requested = new URLSearchParams(search).get('surfaceMaterial');
    return Object.hasOwn(SURFACE_MATERIAL_DEBUG_MODES, requested)
        ? requested
        : SURFACE_MATERIAL_DEBUG_MODES.on;
}

// Development-only gain for proving the shader path. It never changes the
// production constants above and is ignored unless explicitly requested.
export function surfaceMaterialDiagnosticGainFromSearch(search = '') {
    const requested = Number(new URLSearchParams(search).get('surfaceMaterialGain'));
    return Number.isFinite(requested) ? Math.min(4, Math.max(1, requested)) : 1;
}

export function createSurfaceMaterialLodConfig({
    earthRadius = 2,
    mode = SURFACE_MATERIAL_DEBUG_MODES.on,
    diagnosticGain = 1
} = {}) {
    if (!Number.isFinite(earthRadius) || earthRadius <= 0) {
        throw new TypeError('Surface material LOD requires a positive Earth radius.');
    }
    const resolvedMode = Object.hasOwn(SURFACE_MATERIAL_DEBUG_MODES, mode)
        ? mode
        : SURFACE_MATERIAL_DEBUG_MODES.on;
    const resolvedDiagnosticGain = Number.isFinite(diagnosticGain)
        ? Math.min(4, Math.max(1, diagnosticGain))
        : 1;
    return Object.freeze({
        ...SURFACE_MATERIAL_REPRESENTATION,
        ...SURFACE_MATERIAL_LOD,
        ...SURFACE_MATERIAL_RESPONSE,
        earthRadius,
        mode: resolvedMode,
        diagnosticGain: resolvedDiagnosticGain,
        pbrRoughnessAmplitude: SURFACE_MATERIAL_RESPONSE.pbrRoughnessAmplitude * resolvedDiagnosticGain,
        phongSpecularAmplitude: SURFACE_MATERIAL_RESPONSE.phongSpecularAmplitude * resolvedDiagnosticGain,
        mesoFullDistance: earthRadius * SURFACE_MATERIAL_LOD.mesoFullRadiusMultiplier,
        mesoFadeOutDistance: earthRadius * SURFACE_MATERIAL_LOD.mesoFadeOutRadiusMultiplier
    });
}

export function surfaceMaterialLodWeights(cameraDistance, config) {
    if (!Number.isFinite(cameraDistance) || !config) return { meso: 0 };
    const mesoBase = 1 - smoothstep(config.mesoFullDistance, config.mesoFadeOutDistance, cameraDistance);
    return {
        meso: config.mode === SURFACE_MATERIAL_DEBUG_MODES.off ? 0 : mesoBase
    };
}

export function surfaceMaterialLandWeight(relief, seaLevel, config) {
    if (!Number.isFinite(relief) || !Number.isFinite(seaLevel) || !config) return 0;
    return smoothstep(
        seaLevel + config.coastStartReliefOffset,
        seaLevel + config.coastEndReliefOffset,
        relief
    );
}

// CPU mirror used only for deterministic tests and diagnostics. The shader uses
// the same two direction-only bands; neither represents observed surface data.
export function deterministicSphericalMaterialSignal(direction, frequency) {
    const length = Math.hypot(direction?.x, direction?.y, direction?.z);
    if (!Number.isFinite(length) || length === 0 || !Number.isFinite(frequency)) return 0.5;
    const x = direction.x / length;
    const y = direction.y / length;
    const z = direction.z / length;
    const a = Math.sin((x * 1.17 + y * 0.61 + z * 0.83) * frequency + 0.37);
    const b = Math.sin((x * -0.49 + y * 1.31 + z * 0.72) * frequency - 0.91);
    return Math.min(1, Math.max(0, 0.5 + a * 0.30 + b * 0.20));
}
