import { makeAtmosphereMat, setAtmosphereMode } from './atmosphere.js';
import { createEarthMaterial, createEarthMaterialPBR, displacementScaleForExaggeration, syncActiveReliefTexture, verticalExaggerationAtPeak } from './earth-material.js';
import { createEarthRoughnessTexture } from './earth-roughness.js';
import { createSurfaceMaterialLodConfig, surfaceMaterialDebugModeFromSearch, surfaceMaterialDiagnosticGainFromSearch } from './surface-material-lod.js';
import { SURFACE_VISUAL_ALBEDO_SIZE, surfaceVisualCaseFromSearch, surfaceVisualOverridesFromSearch } from './surface-visual-lock.js';
import { makeNightLightsMat } from './night-lights.js';
import { loadBlackMarbleTexture } from './gibs-night-lights.js';
import { loadBlueMarbleSurfaceTexture } from './gibs-surface.js';
import { upgradeEarthTexturesToKtx2 } from './ktx2-support.js';

export function createEarthLayers({
    THREE,
    renderer,
    earthGroup,
    earthMap,
    earthSpecular,
    earthLights,
    earthRelief,
    earthReliefNormal,
    earthReliefSeaLevel,
    earthReliefScale: defaultReliefScale
}) {
    const activeReliefRef = { current: earthRelief };
    const surfaceVisualCase = surfaceVisualCaseFromSearch(window.location.search);
    // Visual-lock A/B overrides only ({} outside a lock case).
    const materialOverrides = surfaceVisualOverridesFromSearch(window.location.search);
    const earthReliefScale = materialOverrides.reliefExaggeration === undefined
        ? defaultReliefScale
        : displacementScaleForExaggeration(materialOverrides.reliefExaggeration);
    // Geometric displacement only; the encoding is sqrt-like, so the factor is
    // quoted at the highest summit (larger on plateaus and lowlands).
    const reliefExaggeration = verticalExaggerationAtPeak(earthReliefScale);
    const reliefTitle = reliefExaggeration === 0
        ? 'Relief: vertical exaggeration ×0 (no geometric displacement; relief shading from ETOPO 2022 normals only)'
        : `Relief: vertical exaggeration ×${reliefExaggeration.toFixed(reliefExaggeration < 10 ? 1 : 0)} at the highest summit (ETOPO 2022 bedrock; displacement ${earthReliefScale.toFixed(4)} scene units per gray unit; nonlinear encoding, larger on plateaus and lowlands; ocean surface flat)`;
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
        earthReliefNormal,
        earthReliefSeaLevel,
        earthReliefScale,
        reliefTextureRef: activeReliefRef,
        surfaceMaterial,
        overrides: materialOverrides
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

    // KTX2 pilot: relief + normal are the two heavy local textures. This tracks
    // the currently-active version of each (placeholder, then KTX2 or PNG
    // fallback) so the lazily-built PBR material always references the right one.
    let activeRelief = earthRelief;
    let activeReliefNormal = earthReliefNormal;
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
                    earthReliefNormal: activeReliefNormal,
                    earthReliefSeaLevel,
                    earthReliefScale,
                    reliefTextureRef: activeReliefRef,
                    surfaceMaterial,
                    overrides: materialOverrides
                });
                return earthMatPBR;
            })
            .catch(error => {
                console.warn('[Earth] PBR roughness material failed to build; staying on Phong.', error);
                return null;
            });
        return earthMatPBRLoading;
    }

    // KTX2-primary upgrade (disabled with `?noktx2`). The material starts with
    // flat placeholders, then swaps in compressed textures; on failure, the PNG
    // fallback is loaded instead.
    upgradeEarthTexturesToKtx2({
        THREE,
        renderer,
        getMaterials: () => [earthMat, earthMatPBR],
        targets: [
            {
                key: 'relief',
                url: 'assets/etopo2022-bedrock-relief-2160x1080.ktx2',
                pngUrl: 'assets/etopo2022-bedrock-relief-2160x1080.png',
                fromTexture: earthRelief,
            },
            {
                key: 'normal',
                url: 'assets/etopo2022-bedrock-normal-2160x1080.ktx2',
                pngUrl: 'assets/etopo2022-bedrock-normal-2160x1080.png',
                fromTexture: earthReliefNormal,
            },
        ],
        onUpgrade: (key, texture) => {
            if (key === 'relief') {
                activeRelief = texture;
                syncActiveReliefTexture([earthMat, earthMatPBR], activeReliefRef, texture);
            }
            else if (key === 'normal') activeReliefNormal = texture;
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
    const nightLightsUpgrade = surfaceVisualCase
        ? Promise.resolve(null)
        : loadBlackMarbleTexture({ THREE, renderer });
    nightLightsUpgrade
        .then(texture => {
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
            publishNightLightsStatus({
                state: 'nasa',
                message: 'Black Marble: annual observed product · 2016 — fades at solar terminator'
            });
        })
        .catch(error => {
            blackMarbleSettled = true;
            clearTimeout(blackMarbleWatchdog);
            console.warn('[Earth] NASA GIBS Black Marble unavailable; keeping local night-lights fallback.', error);
            publishNightLightsStatus({
                state: 'fallback',
                message: 'Black Marble: local fallback active — terminator linked; NASA GIBS unavailable'
            });
        });

    // Upgrade the day-side surface color from the bundled low-resolution CDN
    // texture to a NASA GIBS Blue Marble raster, once it decodes. Blue Marble
    // is non-temporal (a single reference composite, not a daily swath), so a
    // network/CORS failure simply leaves the bundled texture in place — same
    // fail-safe shape as the Black Marble night-lights upgrade above.
    let surfaceSettled = false;
    const surfaceWatchdog = setTimeout(() => {
        if (surfaceSettled) return;
        publishSurfaceStatus({
            state: 'fallback',
            message: 'Surface: bundled fallback texture active — NASA GIBS Blue Marble still loading'
        });
    }, 16_000);

    // A visual lock never selects an albedo source. It keeps the normal GIBS
    // lifecycle intact; same-session OFF/ON begins only after this settles.
    // The visual lock pins one albedo size so comparisons never mix resolutions.
    const surfaceUpgrade = loadBlueMarbleSurfaceTexture({
        THREE,
        renderer,
        sizes: surfaceVisualCase ? [SURFACE_VISUAL_ALBEDO_SIZE] : undefined
    });
    const surfaceReady = surfaceUpgrade
        .then(texture => {
            if (!texture) {
                surfaceSettled = true;
                clearTimeout(surfaceWatchdog);
                publishSurfaceStatus({
                    state: 'locked-fallback',
                    message: 'Surface: stable bundled fallback locked for deterministic material comparison'
                });
                return activeSurfaceMap;
            }
            surfaceSettled = true;
            clearTimeout(surfaceWatchdog);
            const previous = activeSurfaceMap;
            activeSurfaceMap = texture;
            earthMat.map = texture;
            earthMat.needsUpdate = true;
            if (earthMatPBR) {
                earthMatPBR.map = texture;
                earthMatPBR.needsUpdate = true;
            }
            if (previous && previous !== texture) previous.dispose?.();
            publishSurfaceStatus({
                state: 'nasa',
                message: `Surface: NASA GIBS / Blue Marble static reference active (${texture.userData.surfaceResolution})`
            });
            return activeSurfaceMap;
        })
        .catch(error => {
            surfaceSettled = true;
            clearTimeout(surfaceWatchdog);
            console.warn('[Earth] NASA GIBS Blue Marble surface unavailable; keeping bundled fallback texture.', error);
            publishSurfaceStatus({
                state: 'fallback',
                message: 'Surface: bundled fallback texture active — NASA GIBS Blue Marble unavailable'
            });
            return activeSurfaceMap;
        });


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
