// KTX2 pilot (Sprint 0.2) — primary-path, non-destructive texture upgrade.
//
// Behaviour by design:
//   * Default: relief + normal start as tiny flat placeholders, then we load their
//     `.ktx2` (Basis/UASTC) versions and hot-swap them onto the live material(s).
//   * With `?noktx2`: the original PNG pipeline is used for A/B comparison,
//     debugging, or an emergency escape hatch.
//   * On ANY KTX2 failure (missing file, missing transcoder, unsupported GPU),
//     we load the PNG fallback and log a clear warning — never a black globe.
//
// This runs inside earth-eonet-relief.html, whose importmap resolves both
// `three` and `three/addons/`. KTX2Loader is imported dynamically only on the
// default KTX2 path; `?noktx2` fetches no KTX2 loader or transcoder assets.

// Transcoder path is RELATIVE to the document (earth-eonet-relief.html at repo
// root) — NOT absolute. An absolute '/vendor/basis/' would break under a
// GitHub Pages project subpath; './vendor/basis/' resolves correctly both on
// `python -m http.server` and on Pages.
const TRANSCODER_PATH = './vendor/basis/';

// Material slots that may reference the relief/normal textures. We swap by
// reference identity rather than hard-coding which material uses which slot,
// so Phong (bumpMap + displacementMap + normalMap) and PBR (displacementMap +
// normalMap) are both handled generically.
const TEXTURE_SLOTS = [
    'map', 'normalMap', 'bumpMap', 'displacementMap',
    'roughnessMap', 'metalnessMap', 'specularMap',
];

let loaderPromise = null;

export function ktx2Requested() {
    try {
        // KTX2 is ON by default. Escape hatch: `?noktx2` forces the original
        // PNG path (for A/B comparison, debugging, or emergency fallback).
        return !location.search.toLowerCase().includes('noktx2');
    } catch (_) {
        return true;
    }
}

function getLoader(THREE, renderer) {
    if (!loaderPromise) {
        loaderPromise = import('three/addons/loaders/KTX2Loader.js').then(({ KTX2Loader }) =>
            // detectSupport(renderer) is MANDATORY and must run after the renderer
            // exists, otherwise the transcode target format is wrong.
            new KTX2Loader()
                .setTranscoderPath(TRANSCODER_PATH)
                .detectSupport(renderer),
        );
    }
    return loaderPromise;
}

function configureDataTexture(THREE, texture, anisotropy) {
    // Relief + normal are linear DATA textures (not colour) — same as the PNG
    // pipeline in earth-textures.js. KTX2 compressed textures come back with
    // flipY=false; we pre-flipped the source at encode time (isYFlip) so the
    // result matches the flipY=true PNG orientation. Do not touch flipY here.
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
}

function swapTextureInMaterials(materials, oldTexture, newTexture) {
    for (const material of materials) {
        if (!material) continue;
        let touched = false;
        for (const slot of TEXTURE_SLOTS) {
            if (material[slot] === oldTexture) {
                material[slot] = newTexture;
                touched = true;
            }
        }
        if (touched) material.needsUpdate = true;
    }
}

function isStillReferenced(materials, texture) {
    return materials.some(
        material => material && TEXTURE_SLOTS.some(slot => material[slot] === texture),
    );
}

// Fire-and-forget. Returns immediately; upgrades happen asynchronously over the
// already-rendering placeholder, with PNG loaded only if KTX2 cannot be used.
export function upgradeEarthTexturesToKtx2({ THREE, renderer, getMaterials, targets, onUpgrade }) {
    if (!ktx2Requested()) return;
    if (!renderer?.capabilities) {
        console.warn('[KTX2] renderer not available; keeping PNG textures.');
        return;
    }

    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    // Swap a freshly-loaded texture (KTX2 or PNG fallback) into the live
    // materials, replacing whatever is there now (the flat placeholder), then
    // dispose the placeholder.
    const applyTexture = (target, texture) => {
        try {
            configureDataTexture(THREE, texture, anisotropy);
            const previous = target.fromTexture;
            swapTextureInMaterials(getMaterials(), previous, texture);
            target.fromTexture = texture; // future fallbacks swap from the new one
            onUpgrade?.(target.key, texture, previous);
            if (previous !== texture && !isStillReferenced(getMaterials(), previous)) {
                previous.dispose();
            }
        } catch (error) {
            console.warn(`[KTX2] ${target.key} apply failed.`, error);
        }
    };

    // PNG fallback: only fetched if the .ktx2 (or the transcoder) fails. On the
    // happy path the heavy PNG is never downloaded.
    const loadPngFallback = (target) => {
        new THREE.TextureLoader().load(
            target.pngUrl,
            (pngTexture) => applyTexture(target, pngTexture),
            undefined,
            (error) => console.warn(`[KTX2] ${target.key} PNG fallback also failed (${target.pngUrl}).`, error),
        );
    };

    getLoader(THREE, renderer).then((loader) => {
        for (const target of targets) {
            loader.load(
                target.url,
                (texture) => applyTexture(target, texture),
                undefined,
                (error) => {
                    console.warn(`[KTX2] ${target.key} .ktx2 failed (${target.url}); falling back to PNG.`, error);
                    loadPngFallback(target);
                },
            );
        }
    }).catch((error) => {
        console.warn('[KTX2] loader init failed; loading PNG fallback for all targets.', error);
        for (const target of targets) loadPngFallback(target);
    });
}
