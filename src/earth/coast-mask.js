// LOT 43: the land / water weight near the coast from a signed distance field (Natural Earth 10m land v5.1.1,
// public domain, rasterized locally by tools/build-coast-distance.mjs; see src/config/earth-coast-distance.js).
//
// Rule (shader and coastWaterFraction below, the same numbers):
//   d    = signed distance to the coast (km, + land, - water), bilinear between texel centres, |d| <= maxKm;
//   w    = ground footprint of the screen pixel (km), from the uv derivatives;
//   landNE  = clamp(0.5 + d / w, 0, 1)            -> a coast edge one screen pixel wide, at any zoom;
//   inland  = smoothstep(12 km, 20 km, d)          -> inland water (lakes, rivers) keeps the MOD44W fraction, but
//             only from 12-20 km inland: closer, MOD44W at 1/6 deg still holds the coarse sea of its coastal texels;
//   image   = land in the displayed Blue Marble NG albedo (observed): blue <= max(red, green) and not near-black
//             (deep water is near black, where JPEG noise makes red >= blue): (1 - smoothstep(0.9, 1.05, b / max(r, g)))
//             * smoothstep(0.012, 0.03, max(r, g)), linear RGB; 0 south of 60 S (ice shelves: water in NE and MOD44W);
//   gate    = 1 - smoothstep(0.996, 0.9995, MOD44W) -> the 1/6 deg MOD44W cell (observed) is not all water (8 bits: 254/255
//             is about 1 km2 of land in the cell, 255 all water);
//   water   = max((1 - landNE) * (1 - image * gate), MOD44W * inland);
//             a reconstructed source (Natural Earth, generalized at 1:10M) never turns into sea a pixel that the observed
//             image shows as land where MOD44W also sees land in the cell (small islands, generalized coasts); turbid
//             water far from land stays water (gate 0). The image never turns NE land into water (a coarse image loses
//             small islands: not evidence of water). Only the pixel's own land weight uses the image (relief, specular,
//             roughness); the neighbour heights of the relief normal and the vertex displacement do not;
//   far     = smoothstep(maxKm, 1.5 maxKm, w)      -> a pixel wider than the encoded range: MOD44W alone.
// Before the field loads (or if it fails), the water fraction is MOD44W as before (coast-mask-fallback).
// Antarctic ice shelves: water in both Natural Earth land and MOD44W (unchanged).
// Static same-origin asset fetch (documented exception, as the MOD44W mask: an asset, not a data feed); decoded in
// a module worker owned by the mask (terminated on dispose), inline where workers are unavailable.
import { EARTH_COAST_DISTANCE } from '../config/earth-coast-distance.js';

export const COAST_MASK = Object.freeze({
    inlandKm: Object.freeze([12, 20]),
    farFadeFactor: Object.freeze([1, 1.5]), // x maxKm
    minFootprintKm: 0.05,
    touchWidth: 4096, // touch: the field at half resolution (decoded resized)
    // LOT 43 (before push): the observed image keeps its land
    imageRatio: Object.freeze([0.9, 1.05]), // b / max(r, g), linear: land 0.2-0.9 (rock ~0.87), green shallow sea ~1.17
    imageBright: Object.freeze([0.012, 0.03]), // max(r, g), linear (sRGB ~28 -> ~48)
    imageSouthLat: Object.freeze([-62, -58]),
    mod44wLandGate: Object.freeze([0.996, 0.9995]), // 254/255 (>= ~1 km2 of land in the cell) -> open; 255 (all water) -> closed
});
export const COAST_LABEL = EARTH_COAST_DISTANCE.label;
export const COAST_FALLBACK_LABEL = 'Coastline: MODIS MOD44W 1/6° water fraction (Natural Earth coast field unavailable — fallback)';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** JS mirror of coastImageLandTw: land evidence (0..1) of a displayed albedo (linear RGB) at a latitude. */
export function coastImageLand([r, g, b], lat) {
    const m = Math.max(r, g);
    return (1 - smoothstep(COAST_MASK.imageRatio[0], COAST_MASK.imageRatio[1], b / Math.max(m, 1e-4)))
        * smoothstep(COAST_MASK.imageBright[0], COAST_MASK.imageBright[1], m)
        * smoothstep(COAST_MASK.imageSouthLat[0], COAST_MASK.imageSouthLat[1], lat);
}

/** JS mirror of coastWaterTw: water fraction from the distance (km), the pixel footprint (km), MOD44W and the image. */
export function coastWaterFraction({ distanceKm, footprintKm, mod44wWater, imageLand = 0, maxKm = EARTH_COAST_DISTANCE.maxKm, ready = true }) {
    if (!ready) return mod44wWater;
    const d = Math.min(maxKm, Math.max(-maxKm, distanceKm));
    const land = Math.min(1, Math.max(0, 0.5 + d / Math.max(footprintKm, COAST_MASK.minFootprintKm)));
    const gate = 1 - smoothstep(COAST_MASK.mod44wLandGate[0], COAST_MASK.mod44wLandGate[1], mod44wWater);
    const water = Math.max((1 - land) * (1 - imageLand * gate), mod44wWater * smoothstep(COAST_MASK.inlandKm[0], COAST_MASK.inlandKm[1], d));
    const far = smoothstep(COAST_MASK.farFadeFactor[0] * maxKm, COAST_MASK.farFadeFactor[1] * maxKm, footprintKm);
    return water + (mod44wWater - water) * far;
}

/** Decoded field value in [0, 1] (texture .r) -> signed km. */
export const coastDistanceFromSample = (sample, maxKm = EARTH_COAST_DISTANCE.maxKm) => ((sample * 255 - 127.5) / 127.5) * maxKm;

const glslFloat = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));
/** GLSL (fragment <common>): uniforms, coastImageLandTw(albedo, uv), coastWaterTw(uv, mod44wWater, imageLand). Uniform control flow (dFdx). */
export function coastMaskGlsl(maxKm = EARTH_COAST_DISTANCE.maxKm) {
    const m = glslFloat(maxKm);
    return `
        uniform sampler2D uCoastDistTw;
        uniform float uCoastReadyTw;
        // LOT 43: land evidence of the displayed (observed) Blue Marble NG albedo, linear RGB; 0 south of 60 S.
        float coastImageLandTw(vec3 albedo, vec2 uv) {
            float coastImgMaxTw = max(albedo.r, albedo.g);
            return (1.0 - smoothstep(${glslFloat(COAST_MASK.imageRatio[0])}, ${glslFloat(COAST_MASK.imageRatio[1])}, albedo.b / max(coastImgMaxTw, 1e-4)))
                * smoothstep(${glslFloat(COAST_MASK.imageBright[0])}, ${glslFloat(COAST_MASK.imageBright[1])}, coastImgMaxTw)
                * smoothstep(${glslFloat(COAST_MASK.imageSouthLat[0])}, ${glslFloat(COAST_MASK.imageSouthLat[1])}, uv.y * 180.0 - 90.0);
        }
        float coastWaterTw(vec2 uv, float mod44wWater, float imageLand) {
            // LOT 43: Natural Earth 10m coast field near the coast, MOD44W for inland water and the far field; the
            // observed image keeps its land where the MOD44W cell holds land.
            vec2 coastKmTw = vec2(2.0 * PI * 6371.0 * cos(radians(uv.y * 180.0 - 90.0)), PI * 6371.0);
            float coastFootTw = max(length(dFdx(uv) * coastKmTw), length(dFdy(uv) * coastKmTw));
            float coastDTw = (texture2D(uCoastDistTw, uv).r * 255.0 - 127.5) / 127.5 * ${m};
            float coastLandTw = clamp(0.5 + coastDTw / max(coastFootTw, ${glslFloat(COAST_MASK.minFootprintKm)}), 0.0, 1.0);
            float coastGateTw = 1.0 - smoothstep(${glslFloat(COAST_MASK.mod44wLandGate[0])}, ${glslFloat(COAST_MASK.mod44wLandGate[1])}, mod44wWater);
            float coastWaterOutTw = max((1.0 - coastLandTw) * (1.0 - imageLand * coastGateTw), mod44wWater * smoothstep(${glslFloat(COAST_MASK.inlandKm[0])}, ${glslFloat(COAST_MASK.inlandKm[1])}, coastDTw));
            coastWaterOutTw = mix(coastWaterOutTw, mod44wWater, smoothstep(${glslFloat(COAST_MASK.farFadeFactor[0] * maxKm)}, ${glslFloat(COAST_MASK.farFadeFactor[1] * maxKm)}, coastFootTw));
            return mix(mod44wWater, coastWaterOutTw, uCoastReadyTw);
        }`;
}

/** North-first RGBA rows -> south-first R8 (the same flip as the MOD44W mask, flipY = false). */
export function rgbaToR8SouthFirst(rgba, width, height) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const src = (height - 1 - y) * width * 4;
        for (let x = 0; x < width; x++) out[y * width + x] = rgba[src + x * 4];
    }
    return out;
}

/** Blob -> { data: R8 south first, width, height }; `width` < native resizes on decode. Runs in the worker or inline. */
export async function decodeCoastField(blob, width) {
    const height = width / 2;
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none', ...(width !== EARTH_COAST_DISTANCE.width ? { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' } : {}) });
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return { data: rgbaToR8SouthFirst(context.getImageData(0, 0, width, height).data, width, height), width, height };
}

function createCoastDecoder() {
    let worker = null;
    try {
        if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') worker = new Worker(new URL('./coast-mask-worker.js', import.meta.url), { type: 'module' });
    } catch { worker = null; }
    return {
        decode(blob, width) {
            if (!worker) return decodeCoastField(blob, width);
            return new Promise((resolve, reject) => {
                worker.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve(data));
                worker.onerror = (event) => reject(new Error(event.message || 'coast mask worker failed'));
                worker.postMessage({ blob, width });
            });
        },
        terminate() { worker?.terminate(); worker = null; },
    };
}

export function coastFieldWidth({ touch = false, maxTextureSize = 16384 } = {}) {
    return touch || maxTextureSize < EARTH_COAST_DISTANCE.width ? COAST_MASK.touchWidth : EARTH_COAST_DISTANCE.width;
}

function createCoastTexture(THREE, data, width, height) {
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
    texture.userData.source = EARTH_COAST_DISTANCE.label;
    return texture;
}

/**
 * The shared coast field: { uniform, ready, getStatus, dispose }. The uniform objects are shared by every Earth material
 * (as the MOD44W mask). States: loading -> ready | unavailable; disposed is terminal (a late decode is dropped).
 */
export function loadCoastMask({ THREE, touch = false, maxTextureSize = 16384, signal = null, fetchImpl = (...a) => fetch(...a), decoder = null, onStatus = null, url = EARTH_COAST_DISTANCE.file }) {
    const placeholder = createCoastTexture(THREE, new Uint8Array([255]), 1, 1);
    const uniform = { value: placeholder };
    const ready = { value: 0 };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    const owned = decoder || createCoastDecoder();
    const width = coastFieldWidth({ touch, maxTextureSize });
    let status = { state: 'loading', width, label: COAST_LABEL };
    let disposed = false;
    const publish = (next) => { status = { ...status, ...next }; onStatus?.({ ...status }); };
    const done = (async () => {
        await null; // onStatus always runs after the caller has finished its own setup
        try {
            const response = await fetchImpl(url, { signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
            const field = await owned.decode(await response.blob(), width);
            if (disposed) return;
            uniform.value = createCoastTexture(THREE, field.data, field.width, field.height);
            ready.value = 1;
            placeholder.dispose();
            publish({ state: 'ready', width: field.width, gpuBytes: Math.round(field.width * field.height * 4 / 3) });
        } catch (error) {
            if (disposed || controller.signal.aborted) return;
            console.warn('[Earth] Natural Earth coast field unavailable; the coastline stays on MOD44W.', error);
            publish({ state: 'unavailable', label: COAST_FALLBACK_LABEL, error: String(error?.message || error) });
        } finally {
            owned.terminate?.();
        }
    })();
    return {
        uniform,
        ready,
        done,
        getStatus: () => ({ ...status }),
        dispose() {
            if (disposed) return;
            disposed = true;
            controller.abort();
            signal?.removeEventListener?.('abort', abort);
            owned.terminate?.();
            ready.value = 0;
            if (uniform.value !== placeholder) uniform.value.dispose();
            placeholder.dispose();
            status = { ...status, state: 'disposed' };
        },
    };
}
