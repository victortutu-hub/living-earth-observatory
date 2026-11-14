import { fetchEarthUsgs } from './earth-data-runtime.js';
import {
    EARTH_TIME_CAPABILITIES,
    composeHistoricalStatus,
    composeSourceStatus,
    fetchStateFromRuntime,
    formatLoadingDay,
    windowInstants,
} from './temporal-provenance.js';

function formatMagnitude(magnitude) {
    return Number.isFinite(magnitude) ? magnitude.toFixed(1) : 'unknown magnitude';
}

function normalizePlace(place) {
    return String(place || 'Unknown location').replace(/^earthquake\s*-\s*/i, '').trim();
}

// Exported for unit testing (fixture -> normalize -> shape validated), kept
// as a pure function of a GeoJSON feature so it needs no live fetch or DOM.
export function featureToEvent(feature, { minMagnitude = 2.5, endpointBase = '' } = {}) {
    const coords = feature?.geometry?.coordinates;
    const props = feature?.properties || {};
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const [lon, lat, depthKm = 0] = coords.map(Number);
    // Number(null) coerces to 0, which would otherwise pass as a real M0 quake.
    const magnitude = props.mag == null ? NaN : Number(props.mag);
    const time = Number(props.time);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(magnitude) || !Number.isFinite(time)) return null;
    if (magnitude < minMagnitude) return null;

    const place = normalizePlace(props.place);
    const date = new Date(time).toISOString();
    return {
        id: `usgs:${feature.id || `${time}:${lon}:${lat}`}`,
        title: `M ${formatMagnitude(magnitude)} earthquake - ${place}`,
        description: props.title || '',
        categories: [{ id: 'earthquakes', title: 'Earthquakes' }],
        sources: [{ id: 'USGS', url: props.url || endpointBase }],
        geometry: [{
            type: 'Point',
            coordinates: [lon, lat],
            date,
            magnitudeValue: magnitude,
            magnitudeUnit: 'Mw',
            depthKm: Number.isFinite(depthKm) ? depthKm : null
        }],
        sourceProvider: 'USGS',
        sourceMode: 'supplemental',
        sourceUrl: props.url || endpointBase,
        sourceUpdatedAt: date,
        sourceConfidence: 'USGS earthquake feed',
        usgs: {
            code: props.code || feature.id || '',
            place,
            status: props.status || '',
            alert: props.alert || '',
            tsunami: props.tsunami || 0,
            felt: props.felt || 0,
            url: props.url || ''
        }
    };
}

// `referenceMs` is "now" for the request: the browser clock in Live, the end of
// the requested window for a historical day (recency is relative to that day).
function earthquakePriority(event, referenceMs = Date.now()) {
    const geom = event.geometry?.[0] || {};
    const magnitude = Number(geom.magnitudeValue) || 0;
    const ageHours = Math.max(0, (referenceMs - new Date(geom.date).getTime()) / 36e5);
    const majorBoost = magnitude >= 7 ? 900 : magnitude >= 6 ? 520 : magnitude >= 5 ? 260 : 0;
    const todayBoost = ageHours <= 24 ? 70 : ageHours <= 168 ? 25 : 0;
    return majorBoost + magnitude * 100 + todayBoost - ageHours * 0.35;
}

export const USGS_SUMMARY_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary';
export const USGS_FDSN_QUERY = 'https://earthquake.usgs.gov/fdsnws/event/1/query';

/** Live summary feed for a days filter: 2.5_day | 2.5_week | 2.5_month. */
export function usgsSummaryRequest(days, { endpointBase = USGS_SUMMARY_BASE } = {}) {
    const dayWindow = Number(days || 20);
    const feed = dayWindow <= 1 ? 'day' : dayWindow <= 7 ? 'week' : 'month';
    return { feed, url: `${endpointBase}/2.5_${feed}.geojson`, cutoffDays: Math.max(1, dayWindow) };
}

/** FDSN event query for a UTC day window, both ends inclusive. */
export function usgsFdsnUrl(window, { minMagnitude = 2.5, query = USGS_FDSN_QUERY } = {}) {
    const params = new URLSearchParams({
        format: 'geojson',
        starttime: `${window.start}T00:00:00`,
        endtime: `${window.end}T23:59:59`,
        minmagnitude: String(minMagnitude),
        orderby: 'time',
    });
    return `${query}?${params}`;
}

/**
 * The only module that requests USGS (LOT 5): the live summary feeds and the
 * historical FDSN query both go through earth-data-runtime / dataBroker.
 */
export function createUsgsEarthquakeProvider({
    endpointBase = USGS_SUMMARY_BASE,
    minMagnitude = 2.5,
    maxEvents = 240,
    capability = EARTH_TIME_CAPABILITIES.usgs,
    fetchUsgs = fetchEarthUsgs,
} = {}) {
    let disposed = false;
    let enabled = false;
    let loading = false;
    let loadingDay = null;
    let controller = null;
    let generation = 0;
    let lastCount = 0;
    let lastEligible = 0;
    let lastUpdated = null;
    let lastLoadedAt = null;
    let lastWindow = null;
    let fetchState = 'live';
    let lastError = null;

    function resetResult() {
        lastCount = 0;
        lastEligible = 0;
        lastWindow = null;
        lastError = null;
    }

    async function fetchEvents(filters = {}) {
        if (disposed) return [];
        if (!enabled) return [];
        if (filters.category && filters.category !== 'all' && filters.category !== 'earthquakes') return [];

        const day = filters.dataDay || null;
        const resolved = capability.resolve(day);
        // One request in flight: a new day (or refresh) cancels the previous one.
        controller?.abort();
        const own = new AbortController();
        controller = own;
        const current = ++generation;
        resetResult();
        if (!resolved.available) {
            loading = false;
            loadingDay = null;
            lastError = new Error(capability.unavailableMessage(day, resolved.reason));
            lastError.timeUnavailable = true;
            return [];
        }
        loading = true;
        loadingDay = day;
        try {
            let url; let request; let cutoffMs; let referenceMs; let window = null;
            if (resolved.window) {
                window = resolved.window;
                const { startMs, endMs } = windowInstants(window);
                url = usgsFdsnUrl(window, { minMagnitude });
                request = { window, minMagnitude };
                cutoffMs = startMs;
                referenceMs = endMs;
            } else {
                const summary = usgsSummaryRequest(filters.days, { endpointBase });
                url = summary.url;
                request = { feed: summary.feed, minMagnitude };
                referenceMs = Date.now();
                cutoffMs = referenceMs - summary.cutoffDays * 86400000;
            }
            const result = await fetchUsgs(url, { ...request, signal: own.signal });
            if (disposed || current !== generation) return [];
            const data = result.data;
            const eligible = (Array.isArray(data.features) ? data.features : [])
                .map(feature => featureToEvent(feature, { minMagnitude, endpointBase }))
                .filter(Boolean)
                .filter(event => {
                    const time = new Date(event.geometry[0].date).getTime();
                    return time >= cutoffMs && time <= referenceMs;
                });
            const events = eligible
                .sort((a, b) => {
                    const priorityDiff = earthquakePriority(b, referenceMs) - earthquakePriority(a, referenceMs);
                    if (Math.abs(priorityDiff) > 0.001) return priorityDiff;
                    return new Date(b.geometry[0].date) - new Date(a.geometry[0].date);
                })
                .slice(0, maxEvents);
            lastCount = events.length;
            lastEligible = eligible.length;
            lastWindow = window;
            lastUpdated = result.meta.sourceTime || null;
            lastLoadedAt = result.meta.updated || new Date().toISOString();
            fetchState = fetchStateFromRuntime(result);
            return events;
        } catch (error) {
            if (current !== generation) return [];
            lastError = error?.name === 'AbortError' && disposed ? null : error;
            lastCount = 0;
            return [];
        } finally {
            if (current === generation) {
                loading = false;
                loadingDay = null;
                if (controller === own) controller = null;
            }
        }
    }

    function setEnabled(value) {
        enabled = Boolean(value);
        if (!enabled) {
            controller?.abort();
            controller = null;
            generation += 1;
            loading = false;
            loadingDay = null;
            resetResult();
        }
    }

    function getStatus() {
        if (loading) {
            return { enabled, loading, state: 'refreshing', message: loadingDay ? formatLoadingDay('USGS quakes', loadingDay) : 'USGS quakes: loading selected time window...' };
        }
        if (lastError?.timeUnavailable) return { enabled, loading, state: 'unavailable', message: `USGS quakes: ${lastError.message}`, timeUnavailable: true };
        if (lastError) return { enabled, loading, state: 'error', message: `USGS quakes: ${lastError.message || 'network error'}` };
        if (!enabled) return { enabled, loading, state: 'off', message: 'USGS quakes: off' };
        if (lastWindow) {
            // Shown events are capped (maxEvents, by magnitude and recency): say so.
            const count = lastEligible > lastCount ? `${lastCount} of ${lastEligible}` : lastCount;
            const status = composeHistoricalStatus({ sourceKey: 'usgs', source: 'USGS FDSN', noun: 'earthquakes', window: lastWindow, count, unit: `M${minMagnitude}+ events` });
            return { enabled, loading, state: 'on', ...status };
        }
        const status = composeSourceStatus({
            sourceKey: 'usgs',
            message: `USGS quakes: ${lastCount} added to Earthquakes`,
            dataTime: lastUpdated,
            fetchedAt: lastLoadedAt,
            fetchState,
        });
        return { enabled, loading, state: 'on', ...status };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        enabled = false;
        loading = false;
        generation += 1;
        controller?.abort();
        controller = null;
    }

    return {
        fetchEvents,
        setEnabled,
        getStatus,
        dispose
    };
}
