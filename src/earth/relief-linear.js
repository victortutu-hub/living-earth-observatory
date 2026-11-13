// Linear relief (LOT 4b-B): ETOPO 2022 60" ICE SURFACE elevation (the top of
// the Greenland/Antarctic ice sheets, bedrock elsewhere), area-averaged to
// 1/6 deg, stored in METRES as half floats (R16F), plus a MODIS MOD44W water
// fraction (R8). Built by tools/build-relief.mjs; see NOTICE.md for sources.
// ETOPO holds no lake levels: lake surfaces are rendered at 0 m.
//
// The vertical exaggeration is one real constant E over the whole range:
//   displacement (scene units) = surfaceHeight(z) * E / metresPerSceneUnit,
//   surfaceHeight(z) = mix(z, max(z, 0), water)  — the sea (and lakes, whose
//   surface ETOPO bedrock does not hold) is flat at 0 m, while dry land below
//   sea level (Qattara, Death Valley) keeps its negative height.
// Normals come from the same heights in the shader (no normal map), with the
// same gain E, and water samples clamped at 0 m so the sea floor never tilts
// the coast.
import { ATMOSPHERE } from './atmosphere-physics.js';

export const RELIEF_LINEAR_ASSETS = Object.freeze({
    ktx2: 'assets/etopo2022-surface-m-2160x1080.ktx2',
    bin: 'assets/etopo2022-surface-m-2160x1080.r16f.bin',
    waterMask: 'assets/mod44w-water-2160x1080.png',
    width: 2160,
    height: 1080,
});

export const RELIEF_LINEAR_EXAGGERATION = 10;

export const RELIEF_SOURCE = 'NOAA NCEI ETOPO 2022 60" ice surface (DOI 10.25921/fd45-gt74), area-averaged to 1/6 deg, linear metres; water fraction NASA MODIS MOD44W';

/** Scene units per metre of elevation for exaggeration E. */
export function linearDisplacementScale(exaggeration = RELIEF_LINEAR_EXAGGERATION) {
    return exaggeration / ATMOSPHERE.metersPerSceneUnit;
}

/** Height used for geometry and normals: water is flat at 0 m, dry land keeps z. */
export function surfaceHeightM(elevationM, waterFraction) {
    const w = Math.min(1, Math.max(0, waterFraction));
    return elevationM * (1 - w) + Math.max(elevationM, 0) * w;
}

/**
 * JS mirror of the shader normal: central differences of surfaceHeightM on a
 * sphere of radius R, exaggerated by E. Returns the local (east, north, up)
 * components of the unit normal.
 */
export function reliefNormalENU({ heights, water, latDeg, width = RELIEF_LINEAR_ASSETS.width, height = RELIEF_LINEAR_ASSETS.height, exaggeration = RELIEF_LINEAR_EXAGGERATION }) {
    const R = ATMOSPHERE.earthRadiusM;
    const h = (k) => surfaceHeightM(heights[k], water[k]);
    const eastM = 2 * Math.PI * R * Math.max(Math.cos(latDeg * Math.PI / 180), 0.02) / width;
    const northM = Math.PI * R / height;
    const dzde = (h('east') - h('west')) / (2 * eastM);
    const dzdn = (h('north') - h('south')) / (2 * northM);
    const n = [-exaggeration * dzde, -exaggeration * dzdn, 1];
    const length = Math.hypot(...n);
    return n.map((v) => v / length);
}

export function linearReliefLabel(exaggeration = RELIEF_LINEAR_EXAGGERATION) {
    if (!(exaggeration > 0)) return 'Relief: no geometric displacement (linear ETOPO 2022 relief; shading only)';
    const e = Number.isInteger(exaggeration) ? exaggeration : exaggeration.toFixed(1);
    return `Relief: vertical exaggeration ×${e} (linear, ETOPO 2022 60″ ice surface, area-averaged 1/6°; water mask MODIS MOD44W; lake surfaces rendered at 0 m — ETOPO has no lake levels)`;
}

/** Validates and wraps a raw little-endian half-float file (no header, no mips). */
export function decodeR16fBin(buffer, width = RELIEF_LINEAR_ASSETS.width, height = RELIEF_LINEAR_ASSETS.height) {
    const bytes = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.byteLength;
    if (bytes !== width * height * 2) {
        throw new Error(`R16F relief must be ${width}x${height} half floats (${width * height * 2} bytes), got ${bytes}`);
    }
    return buffer instanceof ArrayBuffer
        ? new Uint16Array(buffer)
        : new Uint16Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytes));
}

/** Linear-filtered, repeat-wrapped data texture for half-float metres. */
export function configureReliefTexture(THREE, texture, { mipmapped = false } = {}) {
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = mipmapped ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = false; // rows are stored south first (uv.y = 0 at the south pole)
    texture.needsUpdate = true;
    return texture;
}

export function createReliefDataTexture(THREE, halfBits, width = RELIEF_LINEAR_ASSETS.width, height = RELIEF_LINEAR_ASSETS.height) {
    const texture = new THREE.DataTexture(halfBits, width, height, THREE.RedFormat, THREE.HalfFloatType);
    texture.userData.reliefSource = 'ETOPO 2022 60" ice surface, area-averaged 1/6 deg, metres (R16F)';
    return configureReliefTexture(THREE, texture);
}

/** Flat 0 m placeholder until the real relief arrives. */
export function createFlatReliefTexture(THREE) {
    const texture = new THREE.DataTexture(new Uint16Array(1), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
    texture.userData.placeholder = true;
    return configureReliefTexture(THREE, texture);
}

// Fallback for ?noktx2 or a KTX2 failure. A same-origin static asset fetch
// (documented exception: an asset, not a data feed — no request runtime).
export async function loadReliefBin({ THREE, url = RELIEF_LINEAR_ASSETS.bin, signal = null }) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return createReliefDataTexture(THREE, decodeR16fBin(await response.arrayBuffer()));
}

// --- MOD44W water fraction as R8 (1 byte per texel, not RGBA8) ---------------

/** First channel of RGBA rows, flipped so row 0 is the south (flipY=false). */
export function rgbaToR8SouthFirst(rgba, width, height) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const src = (height - 1 - y) * width * 4;
        for (let x = 0; x < width; x++) out[y * width + x] = rgba[src + x * 4];
    }
    return out;
}

export function createWaterMaskTexture(THREE, data, width, height) {
    const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = width > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.generateMipmaps = width > 1;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    texture.userData.source = 'NASA GIBS MODIS_Water_Mask (MOD44W), water fraction per 1/6 deg texel (R8)';
    return texture;
}

/**
 * The mask ships as an 8-bit grayscale PNG (0.3 MB); it is decoded once into an
 * R8 DataTexture so the GPU holds 1 byte per texel instead of RGBA8. Static
 * same-origin asset fetch (documented exception, not a data feed).
 */
export async function loadWaterMaskR8({ THREE, url = RELIEF_LINEAR_ASSETS.waterMask, signal = null }) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const { width, height } = bitmap;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const rgba = context.getImageData(0, 0, width, height).data;
    return createWaterMaskTexture(THREE, rgbaToR8SouthFirst(rgba, width, height), width, height);
}
