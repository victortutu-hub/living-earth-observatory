import { fetchEarthUsgs } from './earth-data-runtime.js?v=unifiedEarth1';

function formatClock(timestamp) {
    if (!timestamp) return '--:--';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatMagnitude(magnitude) {
    return Number.isFinite(magnitude) ? magnitude.toFixed(1) : 'unknown magnitude';
}

function normalizePlace(place) {
    return String(place || 'Unknown location').replace(/^earthquake\s*-\s*/i, '').trim();
}

function earthquakePriority(event) {
    const geom = event.geometry?.[0] || {};
    const magnitude = Number(geom.magnitudeValue) || 0;
    const ageHours = Math.max(0, (Date.now() - new Date(geom.date).getTime()) / 36e5);
    const majorBoost = magnitude >= 7 ? 900 : magnitude >= 6 ? 520 : magnitude >= 5 ? 260 : 0;
    const todayBoost = ageHours <= 24 ? 70 : ageHours <= 168 ? 25 : 0;
    return majorBoost + magnitude * 100 + todayBoost - ageHours * 0.35;
}

export function createUsgsEarthquakeProvider({
    endpointBase = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary',
    minMagnitude = 2.5,
    maxEvents = 240
} = {}) {
    const activeControllers = new Set();
    let disposed = false;
    let enabled = false;
    let loading = false;
    let lastCount = 0;
    let lastUpdated = null;
    let lastError = null;

    function featureToEvent(feature) {
        const coords = feature?.geometry?.coordinates;
        const props = feature?.properties || {};
        if (!Array.isArray(coords) || coords.length < 2) return null;
        const [lon, lat, depthKm = 0] = coords.map(Number);
        const magnitude = Number(props.mag);
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

    async function fetchEvents(filters = {}) {
        if (disposed) return [];
        if (!enabled) return [];
        if (filters.category && filters.category !== 'all' && filters.category !== 'earthquakes') return [];

        loading = true;
        lastError = null;
        const controller = new AbortController();
        activeControllers.add(controller);
        try {
            const dayWindow = Number(filters.days || 20);
            const feedWindow = dayWindow <= 1 ? 'day' : dayWindow <= 7 ? 'week' : 'month';
            const endpoint = `${endpointBase}/2.5_${feedWindow}.geojson`;
            const cutoff = Date.now() - Math.max(1, dayWindow) * 86400000;
            const result = await fetchEarthUsgs(endpoint, {
                window: feedWindow,
                signal: controller.signal
            });
            const data = result.data;
            const events = (Array.isArray(data.features) ? data.features : [])
                .map(featureToEvent)
                .filter(Boolean)
                .filter(event => new Date(event.geometry[0].date).getTime() >= cutoff)
                .sort((a, b) => {
                    const priorityDiff = earthquakePriority(b) - earthquakePriority(a);
                    if (Math.abs(priorityDiff) > 0.001) return priorityDiff;
                    return new Date(b.geometry[0].date) - new Date(a.geometry[0].date);
                })
                .slice(0, maxEvents);
            lastCount = events.length;
            lastUpdated = Date.parse(result.meta.sourceTime) || Date.now();
            return events;
        } catch (error) {
            lastError = error;
            lastCount = 0;
            return [];
        } finally {
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
        if (loading) return { enabled, loading, state: 'refreshing', message: 'USGS quakes: loading selected time window...' };
        if (lastError) return { enabled, loading, state: 'error', message: `USGS quakes: ${lastError.message || 'network error'}` };
        if (!enabled) return { enabled, loading, state: 'off', message: 'USGS quakes: off' };
        return {
            enabled,
            loading,
            state: 'on',
            message: `USGS quakes: ${lastCount} added to Earthquakes, updated ${formatClock(lastUpdated)}`
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
