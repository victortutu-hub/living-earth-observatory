import { createProxyRequiredError, isPublicProxyDisabledRuntime, proxyRequiredMessage } from './public-runtime.js';
import { EARTH_TIME_CAPABILITIES, composeSourceStatus, fetchStateFromProxyStatus } from './temporal-provenance.js';

function readProxyBase() {
    const params = new URLSearchParams(window.location.search);
    return params.get('proxyBase') || window.NASA_PROXY_BASE || 'http://127.0.0.1:8787';
}

function parseFirmsDate(date, time) {
    if (!date) return null;
    const compactTime = String(time || '0000').padStart(4, '0').slice(0, 4);
    const iso = `${date}T${compactTime.slice(0, 2)}:${compactTime.slice(2)}:00Z`;
    const parsed = new Date(iso);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function confidenceRank(value) {
    const raw = String(value || '').toLowerCase();
    if (raw === 'h' || raw === 'high') return 3;
    if (raw === 'n' || raw === 'nominal' || raw === 'medium') return 2;
    if (raw === 'l' || raw === 'low') return 1;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return 2;
    if (numeric >= 80) return 3;
    if (numeric >= 40) return 2;
    return 1;
}

// NOTA: MAP_KEY-ul FIRMS NU mai e citit aici deloc - sta doar server-side,
// in nasa-proxy-server.js. Fetch-ul de mai jos merge la proxy-ul local, care
// intoarce deja CSV-ul convertit in JSON ({data: {fires: [...]}}) - nu mai
// trebuie nici parseCsv aici.
function rowToEvent(row, { endpointBase, source }) {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    const frp = Number(row.frp);
    const date = parseFirmsDate(row.acq_date, row.acq_time);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !date) return null;

    const confidence = row.confidence || 'unknown';
    const satellite = row.satellite || 'unknown satellite';
    const instrument = row.instrument || source;
    const brightness = Number(row.bright_ti4 || row.brightness || row.bright_t31);
    const titleFrp = Number.isFinite(frp) ? `${frp.toFixed(1)} MW` : 'active';
    const id = `firms:${source}:${date.toISOString()}:${lat.toFixed(4)}:${lon.toFixed(4)}`;

    return {
        id,
        title: `FIRMS fire hotspot - ${titleFrp}`,
        description: `NASA FIRMS ${instrument} hotspot from ${satellite}.`,
        categories: [{ id: 'wildfires', title: 'Wildfires' }],
        sources: [{ id: 'NASA FIRMS', url: endpointBase }],
        geometry: [{
            type: 'Point',
            coordinates: [lon, lat],
            date: date.toISOString(),
            magnitudeValue: Number.isFinite(frp) ? frp : null,
            magnitudeUnit: Number.isFinite(frp) ? 'FRP MW' : ''
        }],
        sourceProvider: 'NASA FIRMS',
        sourceMode: 'supplemental',
        sourceUrl: endpointBase,
        sourceUpdatedAt: date.toISOString(),
        sourceConfidence: `${confidence} confidence hotspot`,
        firms: {
            satellite,
            instrument,
            confidence,
            frp: Number.isFinite(frp) ? frp : null,
            brightness: Number.isFinite(brightness) ? brightness : null,
            dayNight: row.daynight || '',
            version: row.version || '',
            source
        }
    };
}

/**
 * Ranks all eligible hotspots BEFORE truncation: FRP descending, then
 * confidence rank descending, then newest acquisition. Returns the top
 * `maxEvents` plus the eligible count for the "top N of M" status.
 */
export function selectTopHotspots(events, maxEvents) {
    const ranked = [...events].sort((a, b) => {
        const frpDiff = (Number(b.firms?.frp) || 0) - (Number(a.firms?.frp) || 0);
        if (Math.abs(frpDiff) > 0.001) return frpDiff;
        const confidenceDiff = confidenceRank(b.firms?.confidence) - confidenceRank(a.firms?.confidence);
        if (confidenceDiff !== 0) return confidenceDiff;
        return new Date(b.geometry[0].date) - new Date(a.geometry[0].date);
    });
    return { selected: ranked.slice(0, Math.max(0, maxEvents)), eligible: ranked.length };
}

export function createFirmsWildfireProvider({
    source = 'MODIS_NRT',
    area = 'world',
    maxDays = 1,
    maxEvents = 220,
    minConfidenceRank = 2,
    minFrp = 5,
    timeoutMs = 30000
} = {}) {
    const activeControllers = new Set();
    let disposed = false;
    let enabled = false;
    let loading = false;
    let lastCount = 0;
    let lastEligible = 0;
    let lastFetchedAt = null;
    let lastSourceTime = null;
    let lastError = null;
    let lastProxyStatus = null;
    // LOT 5: FIRMS is live-only here (the proxy route has no DATE segment), so
    // a historical day shows nothing and says so instead of today's fires.
    let unavailableDay = null;
    const capability = EARTH_TIME_CAPABILITIES.firms;

    async function fetchEvents(filters = {}) {
        if (disposed) return [];
        unavailableDay = null;
        if (!enabled) return [];
        if (filters.category && filters.category !== 'all' && filters.category !== 'wildfires') return [];
        if (filters.dataDay && !capability.resolve(filters.dataDay).available) {
            for (const active of activeControllers) active.abort();
            unavailableDay = filters.dataDay;
            lastError = null;
            lastCount = 0;
            return [];
        }

        if (isPublicProxyDisabledRuntime()) {
            lastError = createProxyRequiredError('NASA FIRMS');
            lastCount = 0;
            return [];
        }

        loading = true;
        lastError = null;
        const controller = new AbortController();
        activeControllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const proxyBase = readProxyBase();
            const days = Math.max(1, Math.min(maxDays, Number(filters.days || maxDays)));
            const urlParams = new URLSearchParams(window.location.search);
            const effectiveSource = urlParams.get('firmsSensor') || source;
            const effectiveArea = urlParams.get('firmsArea') || area;
            const params = new URLSearchParams({ source: 'firms', sensor: effectiveSource, area: effectiveArea, days: String(days), cache: String(Date.now()) });
            const response = await fetch(`${proxyBase}/nasa-proxy?${params.toString()}`, { signal: controller.signal, cache: 'no-store' });
            if (!response.ok) throw new Error(`Proxy returned ${response.status}`);
            const payload = await response.json();
            if (payload.proxyStatus === 'error') throw new Error(payload.proxyError || 'NASA FIRMS proxy error (ai completat FIRMS_MAP_KEY in nasa-proxy-server.js?)');
            lastProxyStatus = payload.proxyStatus;

            const rows = payload.data?.fires || [];
            const eligible = rows
                .map(row => rowToEvent(row, { endpointBase: 'https://firms.modaps.eosdis.nasa.gov/api/', source: effectiveSource }))
                .filter(Boolean)
                .filter(event => confidenceRank(event.firms?.confidence) >= minConfidenceRank)
                .filter(event => !Number.isFinite(event.firms?.frp) || event.firms.frp >= minFrp);
            const { selected: events, eligible: eligibleCount } = selectTopHotspots(eligible, maxEvents);
            lastCount = events.length;
            lastEligible = eligibleCount;
            // "fetched" = cand proxy-ul a luat datele de la FIRMS, nu ora browserului.
            lastFetchedAt = payload.proxyFetchedAt || new Date().toISOString();
            lastSourceTime = events.reduce((latest, event) => {
                const time = event.geometry?.[0]?.date;
                return !latest || Date.parse(time) > Date.parse(latest) ? time : latest;
            }, null);
            return events;
        } catch (error) {
            lastError = error?.name === 'AbortError'
                ? new Error('request timed out')
                : error;
            lastCount = 0;
            return [];
        } finally {
            clearTimeout(timeout);
            activeControllers.delete(controller);
            loading = false;
        }
    }

    function setEnabled(value) {
        enabled = Boolean(value);
        if (!enabled) {
            loading = false;
            lastError = null;
            lastCount = 0;
        }
    }

    function getStatus() {
        if (enabled && isPublicProxyDisabledRuntime()) {
            return { enabled, loading: false, state: 'off', message: proxyRequiredMessage('NASA FIRMS') };
        }
        if (enabled && unavailableDay) {
            return { enabled, loading: false, state: 'unavailable', timeUnavailable: true, message: `NASA FIRMS: ${capability.unavailableMessage(unavailableDay)}` };
        }
        if (loading) return { enabled, loading, state: 'refreshing', message: 'NASA FIRMS: loading wildfire hotspots...' };
        if (!enabled) return { enabled, loading, state: 'off', message: 'NASA FIRMS: off' };
        if (lastError) return { enabled, loading, state: 'error', message: `NASA FIRMS: ${lastError.message || 'network error'}` };
        // data = cea mai recenta achizitie satelitara dintre hotspot-urile afisate.
        const status = composeSourceStatus({
            sourceKey: 'firms',
            message: `NASA FIRMS: top ${lastCount} of ${lastEligible} hotspots by FRP`,
            dataTime: lastSourceTime,
            fetchedAt: lastFetchedAt,
            fetchState: fetchStateFromProxyStatus(lastProxyStatus),
        });
        return { enabled, loading, state: 'on', ...status };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        enabled = false;
        loading = false;
        for (const controller of activeControllers) controller.abort();
        activeControllers.clear();
    }

    return {
        fetchEvents,
        setEnabled,
        getStatus,
        dispose
    };
}
