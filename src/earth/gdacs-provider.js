import { createProxyRequiredError, isPublicProxyDisabledRuntime, proxyRequiredMessage } from './public-runtime.js';
import { normalizeLonLatCoordinates } from './event-utils.js?v=polyFix2';

function parseDate(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
}

function normalizeEventType(value, title = '') {
    const raw = String(value || '').trim().toUpperCase();
    const lowerTitle = title.toLowerCase();
    if (raw === 'EQ' || lowerTitle.includes('earthquake')) return 'earthquakes';
    if (raw === 'TC' || lowerTitle.includes('cyclone') || lowerTitle.includes('hurricane') || lowerTitle.includes('typhoon')) return 'severeStorms';
    if (raw === 'FL' || lowerTitle.includes('flood')) return 'floods';
    if (raw === 'VO' || lowerTitle.includes('volcano')) return 'volcanoes';
    if (raw === 'DR' || lowerTitle.includes('drought')) return 'drought';
    if (raw === 'WF' || lowerTitle.includes('fire')) return 'wildfires';
    return 'manmade';
}

function readProxyBase() {
    const params = new URLSearchParams(window.location.search);
    return params.get('proxyBase') || window.NASA_PROXY_BASE || 'http://127.0.0.1:8787';
}

function sourceConfidence(alertLevel) {
    const level = String(alertLevel || '').toLowerCase();
    if (level.includes('red')) return 'red alert';
    if (level.includes('orange')) return 'orange alert';
    if (level.includes('green')) return 'green alert';
    return alertLevel || 'GDACS alert';
}

// Feature-ul GDACS vine deja ca GeoJSON curat prin proxy-ul local (vezi
// nasa-proxy-server.js) - nu mai trebuie parsat XML/RSS, nici trecut prin
// un proxy CORS public nesigur (allorigins.win, folosit anterior, cazut des).
function featureToEvent(feature, proxyBase) {
    const props = feature?.properties || {};
    const title = props.eventname || props.name || 'GDACS disaster alert';
    const link = props.url?.report || props.report || `${proxyBase}/nasa-proxy?source=gdacs`;
    const eventType = props.eventtype || '';
    const alertLevel = props.alertlevel || props.episodealertlevel || '';
    const date = parseDate(props.fromdate) || new Date();
    const coords = normalizeLonLatCoordinates(feature?.geometry?.coordinates);
    if (!coords) return null;

    const idSeed = `${props.eventtype || ''}-${props.eventid || ''}-${props.episodeid || ''}` || `${title}:${date.toISOString()}`;
    const category = normalizeEventType(eventType, title);
    const severity = props.severitydata?.severity;
    const country = props.country || '';

    return {
        id: `gdacs:${idSeed}`.replace(/\s+/g, '-'),
        title,
        description: props.description || props.htmldescription || '',
        categories: [{ id: category, title: category }],
        sources: [{ id: 'GDACS', url: link }],
        geometry: [{
            type: 'Point',
            coordinates: coords,
            date: date.toISOString(),
            magnitudeValue: Number.isFinite(severity) ? severity : null,
            magnitudeUnit: Number.isFinite(severity) ? (props.severitydata?.severityunit || 'GDACS severity') : ''
        }],
        sourceProvider: 'GDACS',
        sourceMode: 'fallback',
        sourceUrl: link,
        sourceUpdatedAt: date.toISOString(),
        sourceConfidence: sourceConfidence(alertLevel),
        gdacs: {
            provider: 'EU JRC / UN OCHA',
            eventType: eventType || 'unknown',
            alertLevel: alertLevel || 'unknown',
            country: country || 'unknown',
            severity: severity ?? ''
        }
    };
}

export function createGdacsProvider({
    timeoutMs = 15000,
    maxEvents = 120
} = {}) {
    let lastCount = 0;
    let lastUpdated = null;
    let lastError = null;
    let lastProxyStatus = null;

    async function fetchEvents(filters = {}) {
        if (isPublicProxyDisabledRuntime()) {
            lastError = createProxyRequiredError('GDACS');
            lastCount = 0;
            throw lastError;
        }

        const proxyBase = readProxyBase();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        lastError = null;
        try {
            const url = `${proxyBase}/nasa-proxy?source=gdacs&cache=${Date.now()}`;
            const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
            if (!response.ok) throw new Error(`Proxy returned ${response.status}`);
            const payload = await response.json();
            if (payload.proxyStatus === 'error') throw new Error(payload.proxyError || 'GDACS proxy error');
            lastProxyStatus = payload.proxyStatus;

            const features = payload.data?.features || [];
            const cutoff = Date.now() - Math.max(1, Number(filters.days || 20)) * 86400000;
            const events = features
                .map(feature => featureToEvent(feature, proxyBase))
                .filter(Boolean)
                .filter(event => new Date(event.geometry[0].date).getTime() >= cutoff)
                .filter(event => !filters.category || filters.category === 'all' || event.categories?.[0]?.id === filters.category)
                .sort((a, b) => new Date(b.geometry[0].date) - new Date(a.geometry[0].date))
                .slice(0, maxEvents);

            lastCount = events.length;
            lastUpdated = Date.now();
            return events;
        } catch (error) {
            lastError = error;
            lastCount = 0;
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    function getStatus() {
        if (isPublicProxyDisabledRuntime()) return { state: 'off', message: proxyRequiredMessage('GDACS') };
        if (lastError) return { state: 'error', message: `GDACS: ${lastError.message || 'network error'} (is nasa-proxy-server.js running?)` };
        if (!lastUpdated) return { state: 'off', message: 'GDACS: standby fallback source' };
        const time = new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        const staleTag = lastProxyStatus === 'stale-cache' ? ' (cached, live fetch failed)' : '';
        return { state: 'on', message: `GDACS: ${lastCount} fallback alerts, updated ${time}${staleTag}` };
    }

    return {
        fetchEvents,
        getStatus
    };
}
