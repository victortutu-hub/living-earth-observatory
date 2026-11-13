import { makeAtmosphereMat, setAtmosphereMode } from './atmosphere.js';
import { createEarthMaterial, createEarthMaterialPBR, syncActiveReliefTexture } from './earth-material.js';
import { createEarthRoughnessTexture } from './earth-roughness.js';
import { createSurfaceMaterialLodConfig, surfaceMaterialDebugModeFromSearch, surfaceMaterialDiagnosticGainFromSearch } from './surface-material-lod.js';
import { surfaceVisualCaseFromSearch, surfaceVisualOverridesFromSearch } from './surface-visual-lock.js';
import { makeNightLightsMat } from './night-lights.js';
import { loadBlackMarbleTexture } from './gibs-night-lights.js';
import { watchPageVisibility, whenVisible } from './gibs-tiles.js';
import { loadBlueMarbleSurfaceTexture, surfaceStatus as surfaceStatusFor } from './gibs-surface.js';
import { upgradeEarthTexturesToKtx2 } from './ktx2-support.js';
import {
    RELIEF_LINEAR_ASSETS,
    RELIEF_LINEAR_EXAGGERATION,
    RELIEF_SHADING_GAIN,
    configureReliefTexture,
    linearDisplacementScale,
    linearReliefLabel,
    loadReliefBin
} from './relief-linear.js';

export function createEarthLayers({
    THREE,
    renderer,
    earthGroup,
    earthMap,
    earthSpecular,
    earthLights,
    earthRelief,
    earthWaterMask = null
}) {
    const activeReliefRef = { current: earthRelief };
    const surfaceVisualCase = surfaceVisualCaseFromSearch(window.location.search);
    // Visual-lock A/B overrides only ({} outside a lock case).
    const materialOverrides = surfaceVisualOverridesFromSearch(window.location.search);
    // Geometry: one real exaggeration E. Shading: its own gain G on the
    // shader normals. A lock A/B may override either.
    const reliefExaggeration = materialOverrides.reliefExaggeration ?? RELIEF_LINEAR_EXAGGERATION;
    const shadingGain = materialOverrides.shadingGain ?? RELIEF_SHADING_GAIN;
    const earthReliefScale = linearDisplacementScale(reliefExaggeration);
    const reliefTitle = linearReliefLabel(reliefExaggeration, shadingGain);
    const reliefMaterialOptions = { waterMask: earthWaterMask, reliefExaggeration, shadingGain };
    const surfaceMaterial = createSurfaceMaterialLodConfig({
        earthRadius: 2,
        mode: surfaceMaterialDebugModeFromSearch(window.location.search),
        diagnosticGain: surfaceMaterialDiagnosticGainFromSearch(window.location.search)
    });
    const nightLightsStatus = {
        state: 'loading',
        message: 'Black Marble: loading NASA GIBS / VIIRS 2016 — terminator linked'
    };
    let nightLightsStatusListener = null;

    function publishNightLightsStatus(next) {
        Object.assign(nightLightsStatus, next);
        nightLightsStatusListener?.({ ...nightLightsStatus });
    }

    function setNightLightsStatusListener(listener) {
        nightLightsStatusListener = typeof listener === 'function' ? listener : null;
        nightLightsStatusListener?.({ ...nightLightsStatus });
    }

    const surfaceStatus = {
        state: 'loading',
        message: 'Surface: loading NASA GIBS / Blue Marble Next Generation',
        title: reliefTitle
    };
    let surfaceStatusListener = null;

    function publishSurfaceStatus(next) {
        Object.assign(surfaceStatus, next);
        surfaceStatusListener?.({ ...surfaceStatus });
    }

    function setSurfaceStatusListener(listener) {
        surfaceStatusListener = typeof listener === 'function' ? listener : null;
        surfaceStatusListener?.({ ...surfaceStatus });
    }

    const earthMat = createEarthMaterial({
        THREE,
        earthMap,
        earthSpecular,
        earthRelief,
        earthReliefScale,
        reliefTextureRef: activeReliefRef,
        surfaceMaterial,
        overrides: materialOverrides,
        ...reliefMaterialOptions
    });

    const earth = new THREE.Mesh(new THREE.SphereGeometry(2, 512, 256), earthMat);
    const earthWorldPosition = new THREE.Vector3();
    const cameraWorldPosition = new THREE.Vector3();
    earth.onBeforeRender = (_renderer, _scene, camera) => {
        earth.getWorldPosition(earthWorldPosition);
        camera.getWorldPosition(cameraWorldPosition);
        const cameraDistance = cameraWorldPosition.distanceTo(earthWorldPosition);
        for (const material of [earthMat, earthMatPBR]) {
            const uniform = material?.userData?.shader?.uniforms?.uSurfaceMaterialCameraDistanceTw;
            if (uniform) uniform.value = cameraDistance;
        }
    };
    earthGroup.add(earth);

    // The relief starts as a flat placeholder and is replaced by the KTX2 (or
    // .bin) metres; track the active texture so the lazily-built PBR material
    // always references the right one.
    let activeRelief = earthRelief;
    // Blue Marble surface upgrade (see below): starts as the bundled CDN
    // texture, swapped for the NASA GIBS raster once it decodes. Read at
    // call-time by ensureEarthMatPBR so the PBR material picks up whichever
    // is current, even if it is built lazily after the swap.
    let activeSurfaceMap = earthMap;

    // V3.2 PBR (MeshStandardMaterial) - construit lazy, asincron (canvas
    // classify pe imaginea Blue Marble), fara sa blocheze boot-ul scenei.
    // Pana e gata, comutarea la modul PBR e pur si simplu ignorata.
    let earthMatPBR = null;
    let earthMatPBRLoading = null;
    function ensureEarthMatPBR() {
        if (earthMatPBR || earthMatPBRLoading) return earthMatPBRLoading;
        earthMatPBRLoading = createEarthRoughnessTexture({ THREE })
            .then(earthRoughnessMap => {
                earthMatPBR = createEarthMaterialPBR({
                    THREE,
                    earthMap: activeSurfaceMap,
                    earthRoughnessMap,
                    earthRelief: activeRelief,
                    earthReliefScale,
                    reliefTextureRef: activeReliefRef,
                    surfaceMaterial,
                    overrides: materialOverrides,
                    ...reliefMaterialOptions
                });
                return earthMatPBR;
            })
            .catch(error => {
                console.warn('[Earth] PBR roughness material failed to build; staying on Phong.', error);
                return null;
            });
        return earthMatPBRLoading;
    }

    // KTX2-primary upgrade: the R16F metres (KTX2, or the raw .bin with
    // ?noktx2 / on failure) replace the flat placeholder.
    const reliefTargets = [
        {
            key: 'relief',
            url: RELIEF_LINEAR_ASSETS.ktx2,
            fallback: () => loadReliefBin({ THREE }),
            configure: (texture) => configureReliefTexture(THREE, texture, { mipmapped: (texture.mipmaps?.length || 0) > 1 }),
            fromTexture: earthRelief,
        },
    ];
    upgradeEarthTexturesToKtx2({
        THREE,
        renderer,
        getMaterials: () => [earthMat, earthMatPBR],
        targets: reliefTargets,
        onUpgrade: (key, texture) => {
            if (key !== 'relief') return;
            activeRelief = texture;
            syncActiveReliefTexture([earthMat, earthMatPBR], activeReliefRef, texture);
        },
    });

    function setMaterialMode(mode) {
        if (mode === 'pbr') {
            ensureEarthMatPBR().then(material => {
                if (material) earth.material = material;
            });
        } else {
            earth.material = earthMat;
        }
    }

    // Debug-only same-session A/B hook. It changes only the meso material
    // response uniform; maps, material objects and scene state stay untouched.
    function setSurfaceMaterialResponseEnabled(enabled) {
        const value = enabled ? 1 : 0;
        for (const material of [earthMat, earthMatPBR]) {
            const uniform = material?.userData?.shader?.uniforms?.uSurfaceMaterialMesoEnabledTw;
            if (uniform) uniform.value = value;
        }
        return value === 1;
    }

    function getSurfaceMaterialDebugSnapshot() {
        const map = earth.material?.map;
        const image = map?.image;
        return {
            material: earth.material?.type || 'unknown',
            materialId: earth.material?.uuid || 'unknown',
            mapId: map?.uuid || 'unknown',
            width: image?.naturalWidth || image?.videoWidth || image?.width || 'unknown',
            height: image?.naturalHeight || image?.videoHeight || image?.height || 'unknown',
            source: image?.currentSrc || image?.src || map?.userData?.surfaceSource || 'runtime texture'
        };
    }

    const nightLights = new THREE.Mesh(
        new THREE.SphereGeometry(2.025, 160, 96),
        makeNightLightsMat({ THREE, texture: earthLights })
    );
    nightLights.renderOrder = 2;
    earthGroup.add(nightLights);

    // Diagnostic only: makes the physical day/night boundary inspectable
    // without altering the night-lights shader or the scene lighting.
    const TERMINATOR_SEGMENTS = 128;
    const terminatorGuideGeometry = new THREE.BufferGeometry();
    const terminatorGuidePositions = new Float32Array(TERMINATOR_SEGMENTS * 3);
    terminatorGuideGeometry.setAttribute('position', new THREE.BufferAttribute(terminatorGuidePositions, 3));
    const terminatorGuide = new THREE.LineLoop(
        terminatorGuideGeometry,
        new THREE.LineBasicMaterial({
            color: 0x8fdfff,
            transparent: true,
            opacity: 0.78,
            depthTest: false,
            depthWrite: false
        })
    );
    terminatorGuide.name = 'solar-terminator-guide';
    terminatorGuide.renderOrder = 7;
    terminatorGuide.visible = false;
    earthGroup.add(terminatorGuide);
    const guideReference = new THREE.Vector3();
    const guideTangentA = new THREE.Vector3();
    const guideTangentB = new THREE.Vector3();

    function updateTerminatorGuide(sunDirection) {
        if (!terminatorGuide.visible) return;
        const useYAxis = Math.abs(sunDirection.y) < 0.9;
        guideReference.set(useYAxis ? 0 : 1, useYAxis ? 1 : 0, 0);
        guideTangentA.crossVectors(sunDirection, guideReference).normalize();
        guideTangentB.crossVectors(sunDirection, guideTangentA).normalize();
        for (let index = 0; index < TERMINATOR_SEGMENTS; index += 1) {
            const angle = (index / TERMINATOR_SEGMENTS) * Math.PI * 2;
            const offset = index * 3;
            terminatorGuidePositions[offset] = (guideTangentA.x * Math.cos(angle) + guideTangentB.x * Math.sin(angle)) * 2.085;
            terminatorGuidePositions[offset + 1] = (guideTangentA.y * Math.cos(angle) + guideTangentB.y * Math.sin(angle)) * 2.085;
            terminatorGuidePositions[offset + 2] = (guideTangentA.z * Math.cos(angle) + guideTangentB.z * Math.sin(angle)) * 2.085;
        }
        terminatorGuideGeometry.attributes.position.needsUpdate = true;
    }

    function setTerminatorGuideVisible(visible) {
        terminatorGuide.visible = Boolean(visible);
    }

    // Upgrade the fallback texture only after the observed NASA Black Marble
    // composite has decoded successfully. A network/CORS failure leaves the
    // stable local texture intact.
    let blackMarbleSettled = false;
    const blackMarbleWatchdog = setTimeout(() => {
        if (blackMarbleSettled) return;
        publishNightLightsStatus({
            state: 'fallback',
                message: 'Black Marble: annual observed product (2016); local fallback active — NASA GIBS still loading; terminator linked'
        });
    }, 16_000);

    // Night cases must not change beneath a capture when GIBS finishes loading.
    // A load that fails while the page was hidden (throttled timers/decoding)
    // is retried once when the page becomes visible again.
    function loadNightLights(isRetry) {
        if (surfaceVisualCase) return Promise.resolve(null);
        const visibility = watchPageVisibility();
        return loadBlackMarbleTexture({ THREE, renderer })
            .catch(error => {
                error.retryWhenVisible = !isRetry && visibility.wasHidden();
                throw error;
            })
            .finally(() => visibility.stop());
    }
    function startNightLights(isRetry = false) {
        return loadNightLights(isRetry).then(texture => {
            if (!texture) {
                blackMarbleSettled = true;
                clearTimeout(blackMarbleWatchdog);
                publishNightLightsStatus({
                    state: 'locked-fallback',
                    message: 'Black Marble: stable bundled fallback locked for deterministic material comparison'
                });
                return;
            }
            blackMarbleSettled = true;
            clearTimeout(blackMarbleWatchdog);
            const previous = nightLights.material.uniforms.uMap.value;
            nightLights.material.uniforms.uMap.value = texture;
            if (previous && previous !== texture) previous.dispose?.();
            performance.mark?.('lea:black-marble:wmts-z2', {
                detail: { tiles: texture.userData.gibsTiles, elapsedMs: texture.userData.gibsElapsedMs }
            });
            publishNightLightsStatus({
                state: 'nasa',
                message: `Black Marble: annual observed product · 2016 (NASA GIBS WMTS z${texture.userData.gibsLevel}, ${texture.userData.resolution}) — fades at solar terminator`
            });
        })
        .catch(error => {
            blackMarbleSettled = true;
            clearTimeout(blackMarbleWatchdog);
            console.warn('[Earth] NASA GIBS Black Marble unavailable; keeping local night-lights fallback.', error);
            publishNightLightsStatus({
                state: 'fallback',
                message: error.retryWhenVisible
                    ? 'Black Marble: local fallback active — NASA GIBS tiles did not finish while the page was hidden; retrying when visible'
                    : 'Black Marble: local fallback active — terminator linked; NASA GIBS unavailable'
            });
            if (error.retryWhenVisible) whenVisible().then(() => startNightLights(true));
        });
    }
    startNightLights();

    // Upgrade the day-side surface from the bundled Blue Marble NG texture to
    // NASA GIBS WMTS tiles, level by level (z2 preview, then z3 resampled to
    // 4096x2048). Blue Marble is non-temporal (one reference composite, not a
    // daily swath), so a network/CORS failure simply leaves the bundled
    // texture in place — same fail-safe shape as Black Marble above.
    let surfaceSettled = false;
    let surfaceLevelApplied = false;
    const surfaceWatchdog = setTimeout(() => {
        if (surfaceSettled || surfaceLevelApplied) return;
        publishSurfaceStatus(surfaceStatusFor({ kind: 'still-loading' }));
    }, 16_000);

    function applySurfaceTexture(texture) {
        const previous = activeSurfaceMap;
        activeSurfaceMap = texture;
        earthMat.map = texture;
        earthMat.needsUpdate = true;
        if (earthMatPBR) {
            earthMatPBR.map = texture;
            earthMatPBR.needsUpdate = true;
        }
        if (previous && previous !== texture) previous.dispose?.();
    }

    // A visual lock never selects an albedo source; it loads only z3 so every
    // capture uses the same 4096x2048 albedo (never the z2 preview).
    const surfaceLevels = surfaceVisualCase ? [3] : [2, 3];
    const finalSurfaceLevel = surfaceLevels[surfaceLevels.length - 1];
    // levels: all on the first attempt; a retry (page hidden during the first
    // attempt) asks only for what is still missing.
    function startSurface(levels, isRetry = false) {
        const visibility = watchPageVisibility();
        return loadBlueMarbleSurfaceTexture({
            THREE,
            renderer,
            levels,
            onLevel: (texture, { z, resolution, tiles, elapsedMs, final }) => {
                surfaceLevelApplied = true;
                applySurfaceTexture(texture);
                performance.mark?.(`lea:surface:wmts-z${z}`, { detail: { tiles, elapsedMs, resolution } });
                if (!final) publishSurfaceStatus(surfaceStatusFor({ kind: 'preview', z, resolution }));
            }
        })
            .then(({ texture, z, resolution, failures }) => {
                visibility.stop();
                surfaceSettled = true;
                clearTimeout(surfaceWatchdog);
                const retry = !isRetry && z !== finalSurfaceLevel && visibility.wasHidden();
                publishSurfaceStatus(surfaceStatusFor({ kind: 'settled', z, resolution, finalLevel: finalSurfaceLevel, retryWhenVisible: retry }));
                if (failures.length) console.warn('[Earth] NASA GIBS Blue Marble WMTS: some levels failed.', failures);
                if (retry) whenVisible().then(() => startSurface([finalSurfaceLevel], true));
                return texture;
            })
            .catch(error => {
                visibility.stop();
                surfaceSettled = true;
                clearTimeout(surfaceWatchdog);
                const retry = !isRetry && visibility.wasHidden();
                console.warn('[Earth] NASA GIBS Blue Marble surface unavailable; keeping bundled fallback texture.', error);
                // A retry that fails keeps the level that is already applied.
                if (!(isRetry && surfaceLevelApplied)) {
                    publishSurfaceStatus(surfaceStatusFor({ kind: 'unavailable', retryWhenVisible: retry }));
                }
                if (retry) whenVisible().then(() => startSurface(surfaceLevels, true));
                return activeSurfaceMap;
            });
    }
    const surfaceReady = startSurface(surfaceLevels);


    const atmosphereMat = makeAtmosphereMat(THREE);
    const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(2.075, 128, 80),
        atmosphereMat
    );
    earthGroup.add(atmosphere);

    function applyAtmosphereMode(mode) {
        setAtmosphereMode(atmosphereMat, mode);
    }

    return {
        earth,
        earthMat,
        getEarthMatPBR: () => earthMatPBR,
        setMaterialMode,
        setSurfaceMaterialResponseEnabled,
        getSurfaceMaterialDebugSnapshot,
        surfaceReady,
        nightLights,
        setNightLightsStatusListener,
        setSurfaceStatusListener,
        updateTerminatorGuide,
        setTerminatorGuideVisible,
        atmosphere,
        atmosphereMat,
        applyAtmosphereMode
    };
}
