import { EARTH_LOCAL_TEXTURES } from '../config/earth-local-textures.js';
import { RELIEF_LINEAR_EXAGGERATION, createFlatReliefTexture, createWaterMaskTexture, linearDisplacementScale, loadWaterMaskR8 } from './relief-linear.js';

// Initial surface and fallback when GIBS is unavailable: the same unshaded
// NASA Blue Marble Next Generation product as the live layer, saved once from
// GIBS (public domain; see NOTICE.md). No baked hillshade.
export const BUNDLED_BLUE_MARBLE = 'assets/blue-marble-ng-4096x2048.jpg';

// LOT 30 (step 4): the night-lights fallback, the cloud base layer and the ocean specular mask are local
// files with declared sources (tools/build-earth-textures.mjs, src/config/earth-local-textures.js); they
// replaced three threejs.org textures of undeclared origin. The status texts use these labels.
export const NIGHT_LIGHTS_FALLBACK_LABEL = 'local fallback (NASA Black Marble 2016, Earth Observatory 0.1° map, 3600×1800)';
export const CLOUDS_STATIC_LABEL = "static image (NASA Blue Marble clouds, 2002 release, MODIS; image by Reto Stöckli) — not today's clouds";

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
    const earthMap = textureLoader.load(BUNDLED_BLUE_MARBLE);
    const earthSpecular = textureLoader.load(EARTH_LOCAL_TEXTURES.specular.file);
    const earthClouds = textureLoader.load(EARTH_LOCAL_TEXTURES.clouds.file);
    const earthLights = textureLoader.load(EARTH_LOCAL_TEXTURES.nightLights.file);
    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    [earthMap, earthSpecular, earthClouds, earthLights].forEach(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = maxAnisotropy;
    });
    earthSpecular.colorSpace = THREE.NoColorSpace;
    // The NASA cloud image is greyscale: its brightness is the cloud opacity (cloud-shaders.js uMapLumaAlpha),
    // read as stored values, not sRGB-decoded.
    earthClouds.colorSpace = THREE.NoColorSpace;

    return {
        earthMap,
        earthSpecular,
        earthClouds,
        earthLights,
        ...loadReliefAndWaterMask({ THREE }),
    };
}
