import { ktx2Requested } from './ktx2-support.js?v=ktx2pilot6';

// 1x1 flat placeholder used only on the KTX2-primary path, so the heavy relief/
// normal PNGs are NOT downloaded. The real texture (KTX2, or PNG only if KTX2
// fails) is swapped in a moment later by ktx2-support.
function makeFlatDataTexture(THREE, rgba) {
    const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
}

export function loadEarthTextures({ THREE, renderer, textureLoader }) {
    const textureBase = 'https://threejs.org/examples/textures/planets/';
    const earthMap = textureLoader.load(textureBase + 'earth_atmos_2048.jpg');
    const earthSpecular = textureLoader.load(textureBase + 'earth_specular_2048.jpg');
    const earthClouds = textureLoader.load(textureBase + 'earth_clouds_1024.png');
    const earthLights = textureLoader.load(textureBase + 'earth_lights_2048.png');
    const earthReliefSeaLevel = 0.42;
    const earthReliefScale = 0.18;
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
