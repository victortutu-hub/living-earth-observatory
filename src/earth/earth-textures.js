import { RELIEF_LINEAR_EXAGGERATION, createFlatReliefTexture, createWaterMaskTexture, linearDisplacementScale, loadWaterMaskR8 } from './relief-linear.js';

// Initial surface and fallback when GIBS is unavailable: the same unshaded
// NASA Blue Marble Next Generation product as the live layer, saved once from
// GIBS (public domain; see NOTICE.md). No baked hillshade.
export const BUNDLED_BLUE_MARBLE = 'assets/blue-marble-ng-4096x2048.jpg';

// LOT 30 (PAS 1): three textures still come from threejs.org (three.js examples), with no declared
// source or date. Every status text that describes them uses these labels (not "local", "bundled" or
// "procedural") until they are replaced by declared NASA or locally derived assets.
export const THREEJS_TEXTURE_BASE = 'https://threejs.org/examples/textures/planets/';
export const THREEJS_NIGHT_LIGHTS_LABEL = 'fallback texture earth_lights_2048.png from threejs.org (source undeclared)';
export const THREEJS_CLOUDS_LABEL = "static cloud image earth_clouds_1024.png from threejs.org (source and date undeclared), drifting — not today's clouds";

// Relief: a flat 0 m placeholder now, the R16F metres later (KTX2, or the raw
// .bin; see earth-layers.js). Water mask: MOD44W fraction as R8. Its uniform
// objects are shared by every Earth material, so swapping the texture and
// flipping ready.value reach Phong and PBR at once; until ready, the shaders
// use z <= 0 as water.
function loadReliefAndWaterMask({ THREE }) {
    const placeholder = createWaterMaskTexture(THREE, new Uint8Array(1), 1, 1);
    const earthWaterMask = { uniform: { value: placeholder }, ready: { value: 0 } };
    loadWaterMaskR8({ THREE }).then(
        (texture) => {
            earthWaterMask.uniform.value = texture;
            earthWaterMask.ready.value = 1;
            placeholder.dispose();
        },
        (error) => console.warn('[Earth] MOD44W water mask unavailable; using z <= 0 as water.', error),
    );
    return {
        earthRelief: createFlatReliefTexture(THREE),
        earthReliefScale: linearDisplacementScale(RELIEF_LINEAR_EXAGGERATION),
        earthWaterMask,
    };
}

export function loadEarthTextures({ THREE, renderer, textureLoader }) {
    const textureBase = THREEJS_TEXTURE_BASE;
    const earthMap = textureLoader.load(BUNDLED_BLUE_MARBLE);
    const earthSpecular = textureLoader.load(textureBase + 'earth_specular_2048.jpg');
    const earthClouds = textureLoader.load(textureBase + 'earth_clouds_1024.png');
    const earthLights = textureLoader.load(textureBase + 'earth_lights_2048.png');
    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

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
        ...loadReliefAndWaterMask({ THREE }),
    };
}
