import { ktx2Requested } from './ktx2-support.js';
import { EARTH_RELIEF_SCALE } from './earth-material.js';

// 1x1 flat placeholder used only on the KTX2-primary path, so the heavy relief/
// normal PNGs are NOT downloaded. The real texture (KTX2, or PNG only if KTX2
// fails) is swapped in a moment later by ktx2-support.
function makeFlatDataTexture(THREE, rgba) {
    const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
}

// Initial surface and fallback when GIBS is unavailable: the same unshaded
// NASA Blue Marble Next Generation product as the live layer, saved once from
// GIBS (public domain; see NOTICE.md). No baked hillshade.
export const BUNDLED_BLUE_MARBLE = 'assets/blue-marble-ng-4096x2048.jpg';

export function loadEarthTextures({ THREE, renderer, textureLoader }) {
    const textureBase = 'https://threejs.org/examples/textures/planets/';
    const earthMap = textureLoader.load(BUNDLED_BLUE_MARBLE);
    const earthSpecular = textureLoader.load(textureBase + 'earth_specular_2048.jpg');
    const earthClouds = textureLoader.load(textureBase + 'earth_clouds_1024.png');
    const earthLights = textureLoader.load(textureBase + 'earth_lights_2048.png');
    const earthReliefSeaLevel = 0.42;
    // Vertical exaggeration x10 at Everest (RELIEF_VERTICAL_EXAGGERATION).
    const earthReliefScale = EARTH_RELIEF_SCALE;
    // KTX2-primary: start relief/normal as tiny flat placeholders (no PNG fetch).
    // Default path (no ?ktx2): load the PNGs exactly as before.
    const useKtx2Primary = ktx2Requested();
    const earthRelief = useKtx2Primary
        ? makeFlatDataTexture(THREE, [128, 128, 128, 255])   // flat mid height
        : textureLoader.load('assets/etopo2022-bedrock-relief-2160x1080.png');
    const earthReliefNormal = useKtx2Primary
        ? makeFlatDataTexture(THREE, [128, 128, 255, 255])   // flat tangent normal
        : textureLoader.load('assets/etopo2022-bedrock-normal-2160x1080.png');
    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    earthRelief.colorSpace = THREE.NoColorSpace;
    earthRelief.wrapS = THREE.RepeatWrapping;
    earthRelief.wrapT = THREE.RepeatWrapping;
    earthRelief.anisotropy = maxAnisotropy;

    earthReliefNormal.colorSpace = THREE.NoColorSpace;
    earthReliefNormal.wrapS = THREE.RepeatWrapping;
    earthReliefNormal.wrapT = THREE.RepeatWrapping;
    earthReliefNormal.anisotropy = maxAnisotropy;

    [earthMap, earthSpecular, earthClouds, earthLights].forEach(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = maxAnisotropy;
    });
    earthSpecular.colorSpace = THREE.NoColorSpace;

    return {
        earthMap,
        earthSpecular,
        earthClouds,
        earthLights,
        earthRelief,
        earthReliefNormal,
        earthReliefSeaLevel,
        earthReliefScale
    };
}
