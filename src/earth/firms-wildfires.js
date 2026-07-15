import { createProxyRequiredError, isPublicProxyDisabledRuntime, proxyRequiredMessage } from './public-runtime.js';

function formatClock(timestamp) {
    if (!timestamp) return '--:--';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

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
    let lastUpdated = null;
    let lastError = null;
    let lastProxyStatus = null;

    async function fetchEvents(filters = {}) {
        if (disposed) return [];
        if (!enabled) return [];
        if (filters.category && filters.category !== 'all' && filters.category !== 'wildfires') return [];

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
            const events = rows
                .map(row => rowToEvent(row, { endpointBase: 'https://firms.modaps.eosdis.nasa.gov/api/', source: effectiveSource }))
                .filter(Boolean)
                .filter(event => confidenceRank(event.firms?.confidence) >= minConfidenceRank)
                .filter(event => !Number.isFinite(event.firms?.frp) || event.firms.frp >= minFrp)
                .sort((a, b) => {
                    const frpDiff = (Number(b.firms?.frp) || 0) - (Number(a.firms?.frp) || 0);
                    if (Math.abs(frpDiff) > 0.001) return frpDiff;
                    return new Date(b.geometry[0].date) - new Date(a.geometry[0].date);
                })
                .slice(0, maxEvents);
            lastCount = events.length;
            lastUpdated = Date.now();
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
        if (loading) return { enabled, loading, state: 'refreshing', message: 'NASA FIRMS: loading wildfire hotspots...' };
        if (!enabled) return { enabled, loading, state: 'off', message: 'NASA FIRMS: off' };
        if (lastError) return { enabled, loading, state: 'error', message: `NASA FIRMS: ${lastError.message || 'network error'}` };
        const staleTag = lastProxyStatus === 'stale-cache' ? ' (cached, live fetch failed)' : '';
        return {
            enabled,
            loading,
            state: 'on',
            message: `NASA FIRMS: ${lastCount} wildfire hotspots, updated ${formatClock(lastUpdated)}${staleTag}`
        };
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
