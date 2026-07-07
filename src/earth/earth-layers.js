import { makeAtmosphereMat, setAtmosphereMode } from './atmosphere.js?v=refraction1';
import { createEarthMaterial, createEarthMaterialPBR } from './earth-material.js?v=v3sss1';
import { createEarthRoughnessTexture } from './earth-roughness.js?v=pbrRoughness4';
import { makeNightLightsMat } from './night-lights.js';

export function createEarthLayers({
    THREE,
    earthGroup,
    earthMap,
    earthSpecular,
    earthLights,
    earthRelief,
    earthReliefNormal,
    earthReliefSeaLevel,
    earthReliefScale
}) {
    const earthMat = createEarthMaterial({
        THREE,
        earthMap,
        earthSpecular,
        earthRelief,
        earthReliefNormal,
        earthReliefSeaLevel,
        earthReliefScale
    });

    const earth = new THREE.Mesh(new THREE.SphereGeometry(2, 512, 256), earthMat);
    earthGroup.add(earth);

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
                    earthMap,
                    earthRoughnessMap,
                    earthRelief,
                    earthReliefNormal,
                    earthReliefSeaLevel,
                    earthReliefScale
                });
                return earthMatPBR;
            })
            .catch(error => {
                console.warn('[Earth] PBR roughness material failed to build; staying on Phong.', error);
                return null;
            });
        return earthMatPBRLoading;
    }

    function setMaterialMode(mode) {
        if (mode === 'pbr') {
            ensureEarthMatPBR().then(material => {
                if (material) earth.material = material;
            });
        } else {
            earth.material = earthMat;
        }
    }

    const nightLights = new THREE.Mesh(
        new THREE.SphereGeometry(2.025, 160, 96),
        makeNightLightsMat({ THREE, texture: earthLights })
    );
    nightLights.renderOrder = 2;
    earthGroup.add(nightLights);

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
        nightLights,
        atmosphere,
        atmosphereMat,
        applyAtmosphereMode
    };
}
