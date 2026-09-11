// NASA GIBS MODIS Terra NDSI Snow Cover — a real, observed daily mask
// (confirmed via WMS GetCapabilities: <Dimension name="time"> spans
// 2000-02-24 through today), unlike Blue Marble/Black Marble which are
// non-temporal composites. Same single-global-WMS-raster shape as those.
const SNOW_ICE_LAYER = 'MODIS_Terra_NDSI_Snow_Cover';
const DAY_MS = 86_400_000;
import { createTemporalDescriptor, EARTH_TEMPORAL_LAYERS } from './temporal-provenance.js';

export function snowIceWmsUrl(date, width = 2048, height = 1024) {
    const params = new URLSearchParams({
        SERVICE: 'WMS',
        REQUEST: 'GetMap',
        VERSION: '1.3.0',
        LAYERS: SNOW_ICE_LAYER,
        STYLES: '',
        FORMAT: 'image/png',
        TRANSPARENT: 'true',
        HEIGHT: String(height),
        WIDTH: String(width),
        CRS: 'EPSG:4326',
        BBOX: '-90,-180,90,180',
        TIME: date,
    });
    return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params}`;
}

function isoDateDaysAgo(daysAgo) {
    return new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
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

// MODIS Terra NRT swaths can lag a day or two before the daily mosaic is
// complete; walk back a few days rather than failing on the very latest one.
const LOOKBACK_DAYS = [1, 2, 3];

export async function loadSnowIceMaskTexture({ THREE, width = 2048, height = 1024, timeoutMs = 15_000 }) {
    const errors = [];
    for (const daysAgo of LOOKBACK_DAYS) {
        const date = isoDateDaysAgo(daysAgo);
        const url = snowIceWmsUrl(date, width, height);
        try {
            const image = await loadImage(url, timeoutMs);
            const texture = new THREE.Texture(image);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            texture.needsUpdate = true;
            texture.userData.snowIceDate = date;
            texture.userData.temporal = createTemporalDescriptor({ ...EARTH_TEMPORAL_LAYERS.snowIce, sourceTime: `${date}T00:00:00Z`, loadedAt: new Date(), cacheState: 'unknown' });
            return texture;
        } catch (error) {
            errors.push(`${date}: ${error.message}`);
        }
    }
    throw new Error(`NASA GIBS MODIS Terra NDSI Snow Cover unavailable — ${errors.join('; ')}`);
}
