import { createProxyRequiredError, isPublicProxyDisabledRuntime, proxyRequiredMessage } from './public-runtime.js';
import {
    EARTH_TIME_CAPABILITIES,
    composeHistoricalStatus,
    composeSourceStatus,
    fetchStateFromProxyStatus,
    formatLoadingDay,
    formatUtcDay,
} from './temporal-provenance.js';
import { fetchEarthFirmsDay } from './earth-data-runtime.js';

/**
 * firms-day failure -> what the status says. 404 no-coverage is not an error
 * of the app: the day is outside the MODIS NRT/SP products.
 */
export function classifyDayError(error) {
    const status = error?.status;
    const code = error?.proxyError;
    if (status === 404 || code === 'no-coverage') return { kind: 'no-coverage', text: 'no FIRMS product covers this day' };
    if (status === 429 || code === 'rate-limited') return { kind: 'rate-limited', text: 'FIRMS request budget used, try again later' };
    if (status === 503 || code === 'availability-unknown') return { kind: 'availability', text: 'FIRMS availability unknown' };
    if (status >= 400) return { kind: 'proxy', text: `proxy returned ${status}` };
    return { kind: 'unreachable', text: 'proxy unreachable' };
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

// Eligibility of a hotspot. The proxy's firms-day route applies the same
// thresholds server-side (FIRMS_DAY_ELIGIBILITY in nasa-proxy-server.js,
// CommonJS, so it cannot import this module); a test checks they are equal.
export const FIRMS_ELIGIBILITY = Object.freeze({ minConfidenceRank: 2, minFrpMw: 5 });

export function firmsConfidenceRank(value) {
    return confidenceRank(value);
}

// Shown in the status tooltip on a historical day.
const FIRMS_SOURCE_NOTES = Object.freeze({
    MODIS_NRT: 'MODIS NRT: near real-time detections, provisional; replaced later by Standard Processing.',
    MODIS_SP: 'MODIS SP: Standard Processing, science-quality archive, published with a delay of a few months.',
});

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
    minConfidenceRank = FIRMS_ELIGIBILITY.minConfidenceRank,
    minFrp = FIRMS_ELIGIBILITY.minFrpMw,
    timeoutMs = 30000,
    dayTimeoutMs = 15000,
    fetchDay = fetchEarthFirmsDay,
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
    // A day the capability rejects (before 2000-11-01, lag, future).
    let unavailableDay = null;
    let unavailableReason = null;
    const capability = EARTH_TIME_CAPABILITIES.firms;
    // LOT 9: a historical day goes through the proxy's firms-day route.
    let dayController = null;
    let dayGeneration = 0;
    let dayState = null; // { day, loading, count, eligible, total, source, error }

    function abortLive() {
        for (const active of activeControllers) active.abort();
    }

    function cancelDay() {
        dayGeneration += 1;
        dayController?.abort();
        dayController = null;
    }

    async function fetchHistoricalDay(day) {
        cancelDay();
        const generation = dayGeneration;
        const own = new AbortController();
        dayController = own;
        dayState = { day, loading: true };
        try {
            const url = `${readProxyBase()}/nasa-proxy?${new URLSearchParams({ source: 'firms-day', date: day })}`;
            const result = await fetchDay(url, { day, signal: own.signal, timeout: dayTimeoutMs });
            if (disposed || generation !== dayGeneration) return [];
            const payload = result.data || {};
            if (payload.proxyStatus === 'error') throw Object.assign(new Error(payload.proxyError || 'proxy error'), { proxyError: payload.proxyError });
            const data = payload.data || {};
            const firmsSource = data.firmsSource || 'MODIS';
            const eligible = (data.fires || [])
                .map(row => rowToEvent(row, { endpointBase: 'https://firms.modaps.eosdis.nasa.gov/api/', source: firmsSource }))
                .filter(Boolean)
                .filter(event => confidenceRank(event.firms?.confidence) >= minConfidenceRank)
                .filter(event => !Number.isFinite(event.firms?.frp) || event.firms.frp >= minFrp);
            const { selected } = selectTopHotspots(eligible, maxEvents);
            dayState = {
                day,
                loading: false,
                count: selected.length,
                eligible: Number.isFinite(data.filteredCount) ? data.filteredCount : eligible.length,
                total: Number.isFinite(data.totalCount) ? data.totalCount : null,
                source: firmsSource,
                proxyStatus: payload.proxyStatus || null,
            };
            return selected;
        } catch (error) {
            if (disposed || generation !== dayGeneration) return [];
            dayState = { day, loading: false, error: classifyDayError(error) };
            return [];
        } finally {
            if (generation === dayGeneration && dayController === own) dayController = null;
        }
    }

    async function fetchEvents(filters = {}) {
        if (disposed) return [];
        unavailableDay = null;
        unavailableReason = null;
        if (!filters.dataDay) {
            cancelDay();
            dayState = null;
        }
        if (!enabled) return [];
        if (filters.category && filters.category !== 'all' && filters.category !== 'wildfires') return [];
        if (filters.dataDay) {
            abortLive();
            const resolved = capability.resolve(filters.dataDay);
            if (!resolved.available) {
                cancelDay();
                dayState = null;
                unavailableDay = filters.dataDay;
                unavailableReason = resolved.reason;
                lastError = null;
                lastCount = 0;
                return [];
            }
            if (isPublicProxyDisabledRuntime()) {
                cancelDay();
                dayState = null;
                lastError = createProxyRequiredError('NASA FIRMS');
                lastCount = 0;
                return [];
            }
            lastError = null;
            return fetchHistoricalDay(filters.dataDay);
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
            cancelDay();
            dayState = null;
            loading = false;
            lastError = null;
            lastCount = 0;
        }
    }

    function historicalStatus() {
        const { day } = dayState;
        if (dayState.loading) return { enabled, loading: true, state: 'refreshing', message: formatLoadingDay('NASA FIRMS', day) };
        const error = dayState.error;
        if (error?.kind === 'no-coverage') {
            return { enabled, loading: false, state: 'unavailable', timeUnavailable: true, message: `NASA FIRMS: Not available for ${formatUtcDay(day)} — no FIRMS product covers this day` };
        }
        if (error) return { enabled, loading: false, state: 'error', message: `NASA FIRMS: unavailable for ${formatUtcDay(day)} (${error.text})` };
        const sourceLabel = dayState.source.replace('_', ' ');
        const status = composeHistoricalStatus({
            sourceKey: 'firms',
            source: `NASA FIRMS ${sourceLabel}`,
            noun: 'hotspots',
            day,
            count: `top ${dayState.count} of ${dayState.eligible}`,
            unit: null,
        });
        const notes = [FIRMS_SOURCE_NOTES[dayState.source], dayState.total != null ? `Raw detections that day: ${dayState.total}; eligible (confidence >= nominal, FRP >= ${minFrp} MW): ${dayState.eligible}.` : null]
            .filter(Boolean).join('\n');
        return { enabled, loading: false, state: 'on', message: status.message, title: [status.title, notes].filter(Boolean).join('\n') };
    }

    function getStatus() {
        if (enabled && isPublicProxyDisabledRuntime()) {
            return { enabled, loading: false, state: 'off', message: proxyRequiredMessage('NASA FIRMS') };
        }
        if (enabled && unavailableDay) {
            return { enabled, loading: false, state: 'unavailable', timeUnavailable: true, message: `NASA FIRMS: ${capability.unavailableMessage(unavailableDay, unavailableReason)}` };
        }
        if (enabled && dayState) return historicalStatus();
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
        cancelDay();
        for (const controller of activeControllers) controller.abort();
        activeControllers.clear();
    }

    return {
        // LOT 9: on a historical day the event pipeline renders FIRMS on its
        // own, after EONET/USGS, instead of waiting for it.
        deferInHistory: true,
        fetchEvents,
        setEnabled,
        getStatus,
        dispose
    };
}
