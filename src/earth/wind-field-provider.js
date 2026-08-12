// Sprint 2.2 - sursa de date pentru particulele de vant: Open-Meteo, CORS
// nativ, fara cheie. API-ul e per-locatie (nu servesc un raster global gata
// facut), dar suporta batch prin liste separate prin virgula de lat/lon in
// acelasi request (confirmat direct: 612 puncte / grila de 10 grade -> un
// singur GET, ~600KB, sub o secunda). Asta e suficient pentru un camp
// vectorial rar, pe care GPU-ul il interpoleaza oricum intre celule.
//
// direction e "dinspre" (conventie meteorologica standard) - vectorul de vant
// (incotro se misca aerul) e opusul:
//   u (est) = -speed * sin(directionRad)
//   v (nord) = -speed * cos(directionRad)

const LAT_STEP = 10;
const LON_STEP = 10;
const LAT_MIN = -80;
const LAT_MAX = 80;
const LON_MIN = -180;
const LON_MAX = 170; // 180 ar duplica meridianul cu -180

function buildGrid() {
    const lats = [];
    for (let lat = LAT_MIN; lat <= LAT_MAX; lat += LAT_STEP) lats.push(lat);
    const lons = [];
    for (let lon = LON_MIN; lon <= LON_MAX; lon += LON_STEP) lons.push(lon);
    return { lats, lons };
}

function windUrl(lats, lons) {
    const latFlat = [];
    const lonFlat = [];
    for (const lat of lats) {
        for (const lon of lons) {
            latFlat.push(lat);
            lonFlat.push(lon);
        }
    }
    const params = new URLSearchParams({
        latitude: latFlat.join(','),
        longitude: lonFlat.join(','),
        current: 'wind_speed_10m,wind_direction_10m',
        wind_speed_unit: 'ms',
    });
    return `https://api.open-meteo.com/v1/forecast?${params}`;
}

// R/G = u,v normalizati la [0,1] pe uMaxSpeed (decodati in shader: (c*2-1)*maxSpeed).
// maxSpeed e un plafon de encodare, nu o limita fizica - viteze mai mari se
// clampeaza vizual, nu se pierd date reale (Open-Meteo intoarce m/s brut).
export async function fetchWindFieldTexture({ THREE, maxSpeedMs = 40, timeoutMs = 20_000 }) {
    const { lats, lons } = buildGrid();
    const url = windUrl(lats, lons);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let payload;
    try {
        const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
        if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
        payload = await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
    if (!Array.isArray(payload) || payload.length !== lats.length * lons.length) {
        throw new Error('Open-Meteo wind batch response shape unexpected.');
    }

    const width = lons.length;
    const height = lats.length;
    const data = new Uint8ClampedArray(width * height * 4);
    let index = 0;
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const point = payload[index];
            const speed = Number(point?.current?.wind_speed_10m);
            const directionDeg = Number(point?.current?.wind_direction_10m);
            let u = 0;
            let v = 0;
            if (Number.isFinite(speed) && Number.isFinite(directionDeg)) {
                const rad = directionDeg * Math.PI / 180;
                u = -speed * Math.sin(rad);
                v = -speed * Math.cos(rad);
            }
            const uNorm = Math.max(0, Math.min(1, u / maxSpeedMs * 0.5 + 0.5));
            const vNorm = Math.max(0, Math.min(1, v / maxSpeedMs * 0.5 + 0.5));
            const pixel = (row * width + col) * 4;
            data[pixel] = Math.round(uNorm * 255);
            data[pixel + 1] = Math.round(vNorm * 255);
            data[pixel + 2] = 0;
            data[pixel + 3] = 255;
            index++;
        }
    }

    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    // Longitude grid wraps at the antimeridian; latitude does not (poles clamp
    // to the nearest real row instead of wrapping to the opposite hemisphere).
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    texture.userData = {
        maxSpeedMs,
        latMin: LAT_MIN,
        latMax: LAT_MAX,
        gridPoints: lats.length * lons.length,
        source: 'Open-Meteo current wind_speed_10m / wind_direction_10m, 10 degree global grid',
    };
    return texture;
}
