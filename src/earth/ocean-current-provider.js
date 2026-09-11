// Sprint 2.3 - sursa de date pentru curentii oceanici: Open-Meteo Marine API,
// CORS nativ, fara cheie (roadmap-ul prevedea Copernicus Marine cu cont + cheie
// + proxy; Open-Meteo Marine acopera acelasi semnal fara acel cost). Confirmat:
// batch prin liste lat/lon separate prin virgula intr-un singur GET, exact ca
// API-ul de vreme.
//
// ocean_current_direction e "incotro" (conventie oceanografica, opusa celei
// meteo pentru vant), deci vectorul curentului e direct pe directie:
//   u (est)  = speed * sin(directionRad)
//   v (nord) = speed * cos(directionRad)
// Viteza vine in km/h -> convertita in m/s (/3.6).
//
// MASCA DE USCAT: peste continente API-ul intoarce velocity/direction = null.
// Encodam in canalul B: 255 = ocean (are date), 0 = uscat. Motorul de particule
// (landAware) forteaza respawn peste uscat ca sa nu curga curenti peste
// continente.
//
// CACHE: acelasi mecanism ca la vant (sessionStorage, TTL 15 min, fallback la
// 429). Cheie separata ca sa nu se amestece cu campul de vant.

const LAT_STEP = 10;
const LON_STEP = 10;
const LAT_MIN = -80;
const LAT_MAX = 80;
const LON_MIN = -180;
const LON_MAX = 170;

const CACHE_KEY = 'lea-ocean-current-v1';
const CACHE_TTL_MS = 30 * 60 * 1000; // curentii se schimba lent; 30 min e ok
import { createTemporalDescriptor, EARTH_TEMPORAL_LAYERS } from './temporal-provenance.js';

function buildGrid() {
    const lats = [];
    for (let lat = LAT_MIN; lat <= LAT_MAX; lat += LAT_STEP) lats.push(lat);
    const lons = [];
    for (let lon = LON_MIN; lon <= LON_MAX; lon += LON_STEP) lons.push(lon);
    return { lats, lons };
}

function marineUrl(lats, lons) {
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
        current: 'ocean_current_velocity,ocean_current_direction',
    });
    return `https://marine-api.open-meteo.com/v1/marine?${params}`;
}

function encodeGrid(payload, width, height, maxSpeedMs) {
    const data = new Array(width * height * 4);
    let index = 0;
    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const point = payload[index];
            const speedKmh = point?.current?.ocean_current_velocity;
            const directionDeg = point?.current?.ocean_current_direction;
            const isOcean = Number.isFinite(Number(speedKmh)) && Number.isFinite(Number(directionDeg));
            let u = 0;
            let v = 0;
            if (isOcean) {
                const speed = Number(speedKmh) / 3.6; // km/h -> m/s
                const rad = Number(directionDeg) * Math.PI / 180;
                u = speed * Math.sin(rad);
                v = speed * Math.cos(rad);
            }
            const uNorm = Math.max(0, Math.min(1, u / maxSpeedMs * 0.5 + 0.5));
            const vNorm = Math.max(0, Math.min(1, v / maxSpeedMs * 0.5 + 0.5));
            const pixel = (row * width + col) * 4;
            data[pixel] = Math.round(uNorm * 255);
            data[pixel + 1] = Math.round(vNorm * 255);
            data[pixel + 2] = isOcean ? 255 : 0; // masca de uscat
            data[pixel + 3] = 255;
            index++;
        }
    }
    return { width, height, maxSpeedMs, gridPoints: width * height, data };
}

function readCache() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.data) ? parsed : null;
    } catch {
        return null;
    }
}

function writeCache(grid) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...grid, t: Date.now() }));
    } catch {
        // sessionStorage indisponibil - cache-ul e optional.
    }
}

async function fetchOceanGrid(timeoutMs, maxSpeedMs) {
    const { lats, lons } = buildGrid();
    const url = marineUrl(lats, lons);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let payload;
    try {
        const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
        if (!response.ok) throw new Error(`Open-Meteo Marine HTTP ${response.status}`);
        payload = await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
    if (!Array.isArray(payload) || payload.length !== lats.length * lons.length) {
        throw new Error('Open-Meteo Marine batch response shape unexpected.');
    }
    return encodeGrid(payload, lons.length, lats.length, maxSpeedMs);
}

function buildTexture(THREE, grid, { cached, cacheState }) {
    const data = new Uint8ClampedArray(grid.data);
    const texture = new THREE.DataTexture(data, grid.width, grid.height, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;

    // Masca de uscat separata, cu filtrare NEAREST: taierea la randare
    // foloseste asta ca sa nu interpoleze intre celula-ocean si celula-uscat
    // (interpolarea liniara lasa particule adanc in interiorul continentelor).
    // Advectia foloseste in continuare textura liniara de mai sus (u/v neted).
    const maskTexture = new THREE.DataTexture(new Uint8ClampedArray(grid.data), grid.width, grid.height, THREE.RGBAFormat);
    maskTexture.wrapS = THREE.RepeatWrapping;
    maskTexture.wrapT = THREE.ClampToEdgeWrapping;
    maskTexture.minFilter = THREE.NearestFilter;
    maskTexture.magFilter = THREE.NearestFilter;
    maskTexture.colorSpace = THREE.NoColorSpace;
    maskTexture.needsUpdate = true;

    texture.userData = {
        maskTexture,
        maxSpeedMs: grid.maxSpeedMs,
        latMin: LAT_MIN,
        latMax: LAT_MAX,
        gridPoints: grid.gridPoints,
        cached,
        temporal: createTemporalDescriptor({ ...EARTH_TEMPORAL_LAYERS.oceanCurrents, loadedAt: grid.t || new Date(), cacheState }),
        source: 'Open-Meteo Marine ocean_current_velocity / ocean_current_direction, 10 degree global grid',
    };
    return texture;
}

export async function fetchOceanCurrentTexture({ THREE, maxSpeedMs = 3, timeoutMs = 20_000 }) {
    const cached = readCache();
    const isFresh = cached && cached.maxSpeedMs === maxSpeedMs && (Date.now() - cached.t) < CACHE_TTL_MS;
    if (isFresh) {
        return buildTexture(THREE, cached, { cached: true, cacheState: 'fresh' });
    }
    try {
        const grid = await fetchOceanGrid(timeoutMs, maxSpeedMs);
        writeCache(grid);
        return buildTexture(THREE, grid, { cached: false, cacheState: 'fresh' });
    } catch (error) {
        if (cached && cached.maxSpeedMs === maxSpeedMs) {
            return buildTexture(THREE, cached, { cached: true, cacheState: 'stale' });
        }
        throw error;
    }
}
