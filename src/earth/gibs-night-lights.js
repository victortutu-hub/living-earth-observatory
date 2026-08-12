// NASA GIBS Black Marble is an observed annual nighttime-light composite.
// Keep the WMS request global and seam-free; the local texture remains the
// startup/failure fallback.
export function blackMarbleWmsUrl(year = 2016) {
    if (year !== 2012 && year !== 2016) throw new RangeError('NASA GIBS Black Marble is available here for 2012 or 2016.');
    const params = new URLSearchParams({
        SERVICE: 'WMS',
        REQUEST: 'GetMap',
        VERSION: '1.3.0',
        LAYERS: 'VIIRS_Black_Marble',
        STYLES: '',
        FORMAT: 'image/png',
        TRANSPARENT: 'false',
        HEIGHT: '1024',
        WIDTH: '2048',
        CRS: 'EPSG:4326',
        BBOX: '-90,-180,90,180',
        TIME: `${year}-01-01`,
    });
    return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params}`;
}

export async function loadBlackMarbleTexture({ THREE, renderer, year = 2016, timeoutMs = 15_000 }) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.src = blackMarbleWmsUrl(year);
    let timeoutId = null;
    try {
        await Promise.race([
            image.decode(),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`NASA GIBS Black Marble timed out after ${timeoutMs} ms.`)), timeoutMs);
            })
        ]);
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }

    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return texture;
}
