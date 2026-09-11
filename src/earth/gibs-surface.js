// NASA GIBS Blue Marble Shaded Relief & Bathymetry — a single, seamless,
// non-temporal global composite (unlike the daily VIIRS true-colour product
// in cloud-system.js, which is stitched from separate orbital swaths and
// showed hard seams when reassembled from tiles). Because this layer is one
// continuous NASA-rendered raster, a single large WMS GetMap request is both
// simpler and safer than reassembling WMTS tiles client-side: there is no
// swath boundary to gate against, so composeGibsEquirectangularMosaic (built
// for the harder tiled-streaming case) is not needed here.
const BLUE_MARBLE_LAYER = 'BlueMarble_ShadedRelief_Bathymetry';
import { EARTH_TEMPORAL_LAYERS } from './temporal-provenance.js';

// Largest-to-smallest fallback ladder. GIBS WMS enforces a server-side
// maximum image size and any request can time out on a slow link; rather
// than give up and keep the low-resolution bundled texture, retry at half
// resolution before accepting defeat.
const SIZE_LADDER = Object.freeze([
    { width: 8192, height: 4096 },
    { width: 4096, height: 2048 },
    { width: 2048, height: 1024 },
]);

export function blueMarbleWmsUrl(width, height) {
    const params = new URLSearchParams({
        SERVICE: 'WMS',
        REQUEST: 'GetMap',
        VERSION: '1.3.0',
        LAYERS: BLUE_MARBLE_LAYER,
        STYLES: '',
        FORMAT: 'image/jpeg',
        TRANSPARENT: 'false',
        HEIGHT: String(height),
        WIDTH: String(width),
        CRS: 'EPSG:4326',
        BBOX: '-90,-180,90,180',
    });
    return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params}`;
}

async function loadImage(url, timeoutMs) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.src = url;
    let timeoutId = null;
    try {
        await Promise.race([
            image.decode(),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
            })
        ]);
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
    return image;
}

// Walks the size ladder from largest to smallest, returning the first
// resolution that loads successfully. Throws only if every size fails.
export async function loadBlueMarbleSurfaceTexture({ THREE, renderer, timeoutMs = 20_000 }) {
    const errors = [];
    for (const { width, height } of SIZE_LADDER) {
        const url = blueMarbleWmsUrl(width, height);
        try {
            const image = await loadImage(url, timeoutMs);
            const texture = new THREE.Texture(image);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            texture.needsUpdate = true;
            texture.userData.surfaceResolution = `${width}x${height}`;
            texture.userData.surfaceSource = 'NASA GIBS / Blue Marble Shaded Relief and Bathymetry';
            texture.userData.temporal = EARTH_TEMPORAL_LAYERS.blueMarble;
            return texture;
        } catch (error) {
            errors.push(`${width}x${height}: ${error.message}`);
        }
    }
    throw new Error(`NASA GIBS Blue Marble unavailable at all resolutions — ${errors.join('; ')}`);
}
