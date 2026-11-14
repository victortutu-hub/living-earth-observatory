// Faza 1 - Sprint 1.1: prima sursa adaugata prin registry-ul de layere, ca test
// al contractului LayerPlugin. Un SINGUR fisier + o linie de inregistrare in
// app-services.js. Daca a durat mai mult de ~30 min sau a fost nevoie sa atinga
// alte fisiere, contractul nu e destul de bun si trebuie rafinat (regula din
// roadmap, Sprint 1.1).
//
// Smithsonian GVP - Holocene volcanoes: GeoJSON public prin GeoServer WFS,
// fara cheie. Este 'observed' (masuratori/inregistrari reale ale vulcanilor
// Holocene), nu interpretare procedurala.

// GeoServer-ul GVP nu trimite Access-Control-Allow-Origin, deci mergem prin
// proxy-ul propriu (source=gvp), la fel ca GDACS/FIRMS. Baza de proxy se rezolva
// identic cu restul aplicatiei.
import { EARTH_TIME_CAPABILITIES } from '../temporal-provenance.js';

function readProxyBase() {
    const params = new URLSearchParams(location.search);
    return params.get('proxyBase') || window.NASA_PROXY_BASE || 'http://127.0.0.1:8787';
}

// Culoare dupa recenta ultimei eruptii: mai rosu = mai recent.
function eruptionColor(lastEruptionYear) {
    const year = Number(lastEruptionYear);
    if (!Number.isFinite(year)) return 0xc9752f;          // necunoscut - chihlimbar stins
    const now = new Date().getFullYear();
    const age = now - year;
    if (age <= 25) return 0xff5a2c;                        // eruptie foarte recenta
    if (age <= 120) return 0xff8a3d;
    if (age <= 600) return 0xe0a24a;
    return 0xb08040;                                       // Holocen, dar demult
}

export const gvpVolcanoesPlugin = {
    id: 'gvp',
    label: 'GVP volcanoes',
    sourceKey: 'gvp', // provenance from source-registry ('observed')
    temporal: { temporalType: 'historical-catalog', sceneTimeCompatibility: 'static', cacheState: 'unknown' },
    // The catalog as published today (last eruption years may postdate a past day).
    timeCapability: EARTH_TIME_CAPABILITIES.gvp,
    attribution: 'Smithsonian Institution - Global Volcanism Program (GVP)',
    license: 'Smithsonian GVP terms; attribution retained.',
    source: { url: 'proxy:gvp', requiresProxy: true, apiKey: null },
    render: 'points',
    async fetch(signal) {
        const proxyBase = readProxyBase();
        const response = await fetch(`${proxyBase}/nasa-proxy?source=gvp`, { signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload.proxyStatus === 'error') throw new Error(payload.proxyError || 'proxy error');
        // Invelisul proxy-ului ramane intreg: registry-ul citeste din el
        // proxyStatus/proxyFetchedAt pentru statusul "fetched".
        return payload;
    },
    normalize(raw) {
        // Accepta atat invelisul proxy-ului ({data: FeatureCollection}) cat si
        // un FeatureCollection direct.
        const collection = raw?.data && !Array.isArray(raw?.features) ? raw.data : raw;
        const features = Array.isArray(collection?.features) ? collection.features : [];
        const items = [];
        for (const feature of features) {
            const coords = feature?.geometry?.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) continue;
            const lon = Number(coords[0]);
            const lat = Number(coords[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
            const props = feature.properties || {};
            const lastEruption = props.Last_Eruption_Year ?? props.last_eruption_year;
            items.push({
                lon,
                lat,
                size: 8.5,
                color: eruptionColor(lastEruption),
                // Payload pentru panoul de selectie (acelasi renderDetails ca EONET/ISS/Luna)
                title: props.Volcano_Name || 'Unknown volcano',
                detail: buildDetail(props, lon, lat)
            });
        }
        return items;
    }
};

function fmtYear(year) {
    const y = Number(year);
    if (!Number.isFinite(y)) return 'unknown';
    return y < 0 ? `${Math.abs(y)} BCE` : `${y} CE`;
}

function buildDetail(props, lon, lat) {
    const lines = [
        { label: 'Type', value: props.Primary_Volcano_Type || 'unknown' },
        { label: 'Last eruption', value: fmtYear(props.Last_Eruption_Year) },
        { label: 'Location', value: [props.Country, props.Region].filter(Boolean).join(' - ') || 'unknown' },
        { label: 'Coordinates', value: `${lat.toFixed(2)} lat, ${lon.toFixed(2)} lon` }
    ];
    if (Number.isFinite(Number(props.Elevation))) {
        lines.push({ label: 'Elevation', value: `${Math.round(Number(props.Elevation))} m` });
    }
    if (props.Major_Rock_Type) lines.push({ label: 'Rock type', value: props.Major_Rock_Type });
    if (props.Evidence_Category) lines.push({ label: 'Evidence', value: props.Evidence_Category });
    lines.push({ label: 'Source', value: 'Smithsonian GVP - Holocene Volcano List' });
    if (props.Volcano_Number) {
        lines.push({ label: 'Original link', value: `https://volcano.si.edu/volcano.cfm?vn=${props.Volcano_Number}` });
    }
    return lines;
}
