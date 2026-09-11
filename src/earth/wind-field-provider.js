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
//
// CACHE: Open-Meteo limiteaza cererile pe minut (HTTP 429). Campul de vant se
// schimba lent (orar), deci pastram grila encodata in sessionStorage: reload-
// urile si re-toggle-urile refolosesc cache-ul in loc sa loveasca API-ul. La
// 429/eroare de retea, cadem pe cache chiar daca e mai vechi decat TTL-ul.

const LAT_STEP = 10;
const LON_STEP = 10;
const LAT_MIN = -80;
const LAT_MAX = 80;
const LON_MIN = -180;
const LON_MAX = 170; // 180 ar duplica meridianul cu -180

const CACHE_KEY = 'lea-wind-field-v1';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minute: campul de vant se schimba orar
import { createTemporalDescriptor, EARTH_TEMPORAL_LAYERS } from './temporal-provenance.js';

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

// Encodeaza payload-ul in R/G = u,v normalizati la [0,255] pe maxSpeedMs.
// Returneaza un obiect JSON-serializabil (data e Array simplu), ca sa poata fi
// pus direct in sessionStorage. maxSpeedMs e un plafon de encodare, nu o limita
// fizica - viteze mai mari se clampeaza vizual, nu se pierd date reale.
function encodeGrid(payload, width, height, maxSpeedMs) {
    const data = new Array(width * height * 4);
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
        // sessionStorage plin / indisponibil (private mode) - cache-ul e optional.
    }
}

async function fetchWindGrid(timeoutMs, maxSpeedMs) {
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
    return encodeGrid(payload, lons.length, lats.length, maxSpeedMs);
}

function buildTexture(THREE, grid, { cached, cacheState }) {
    const data = new Uint8ClampedArray(grid.data);
    const texture = new THREE.DataTexture(data, grid.width, grid.height, THREE.RGBAFormat);
    // Longitude grid wraps at the antimeridian; latitude does not (poles clamp
    // to the nearest real row instead of wrapping to the opposite hemisphere).
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    texture.userData = {
        maxSpeedMs: grid.maxSpeedMs,
        latMin: LAT_MIN,
        latMax: LAT_MAX,
        gridPoints: grid.gridPoints,
        cached,
        temporal: createTemporalDescriptor({ ...EARTH_TEMPORAL_LAYERS.wind, loadedAt: grid.t || new Date(), cacheState }),
        source: 'Open-Meteo current wind_speed_10m / wind_direction_10m, 10 degree global grid',
    };
    return texture;
}

export async function fetchWindFieldTexture({ THREE, maxSpeedMs = 40, timeoutMs = 20_000 }) {
    const cached = readCache();
    const isFresh = cached && cached.maxSpeedMs === maxSpeedMs && (Date.now() - cached.t) < CACHE_TTL_MS;
    if (isFresh) {
        return buildTexture(THREE, cached, { cached: true, cacheState: 'fresh' });
    }

    try {
        const grid = await fetchWindGrid(timeoutMs, maxSpeedMs);
        writeCache(grid);
        return buildTexture(THREE, grid, { cached: false, cacheState: 'fresh' });
    } catch (error) {
        // 429 / retea: foloseste orice cache (chiar mai vechi decat TTL) daca
        // exista, in loc sa esueze complet.
        if (cached && cached.maxSpeedMs === maxSpeedMs) {
            return buildTexture(THREE, cached, { cached: true, cacheState: 'stale' });
        }
        throw error;
    }
}
