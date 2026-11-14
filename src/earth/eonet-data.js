import { isPublicProxyDisabledRuntime, proxyRequiredMessage } from './public-runtime.js';
import { normalizeEventGeometry } from './event-utils.js';
import { fetchEarthEonet } from './earth-data-runtime.js';
import {
    EARTH_TIME_CAPABILITIES,
    composeHistoricalStatus,
    composeSourceStatus,
    fetchStateFromRuntime,
    formatLoadingDay,
    windowInstants,
} from './temporal-provenance.js';

/**
 * EONET request URL. Live: the status/days filters (today's behaviour). A
 * historical day: status=all with start/end, the window ending on that day.
 */
export function buildEonetUrl(apiUrl, { status = 'open', days = '20', category = 'all', window = null } = {}, { limit = 250 } = {}) {
    const params = window
        ? new URLSearchParams({ status: 'all', start: window.start, end: window.end, limit: String(limit) })
        : new URLSearchParams({ status, days, limit: String(limit) });
    if (category && category !== 'all') params.set('category', category);
    return `${apiUrl}?${params.toString()}`;
}

/**
 * Keeps only the geometry recorded inside the window: an event that continued
 * after the chosen day must not show where it was later. Events without any
 * geometry in the window are dropped.
 */
export function clipEventToWindow(event, window) {
    if (!window) return event;
    const { startMs, endMs } = windowInstants(window);
    const geometry = (event.geometry || []).filter(geom => {
        const time = Date.parse(geom?.date);
        return Number.isFinite(time) && time >= startMs && time <= endMs;
    });
    return geometry.length ? { ...event, geometry } : null;
}

/** Transport label for a requestRuntime meta; a live network response is never "cached". */
export function eonetTransportLabel(meta) {
    if (!meta) return '';
    if (meta.cache === 'service-worker-cache') {
        return meta.freshness === 'stale' ? 'cached / stale' : 'cached / fresh';
    }
    if (meta.cache === 'hit') return 'cached / fresh';
    return 'live / fresh';
}

export function createEonetDataSource({
    apiUrl,
    latestGeometry,
    eventCategory,
    timeoutMs = 15000,
    limit = 250,
    supplementalProviders = [],
    fallbackProviders = [],
    staleThresholdMs = 48 * 3600000,
    onSourceStateChange = () => {},
    getDataDay = () => null,
    capability = EARTH_TIME_CAPABILITIES.eonet,
    gdacsCapability = EARTH_TIME_CAPABILITIES.gdacs,
    fetchEonet = fetchEarthEonet,
    // LOT 9: results of providers marked deferInHistory (FIRMS), delivered
    // after the EONET/USGS events of the same historical day were returned.
    onDeferredEvents = () => {},
}) {
    const activeControllers = new Set();
    let disposed = false;
    let nasaController = null;
    let nasaGeneration = 0;
    let deferredGeneration = 0;

    function withTransport(message, meta) {
        const label = eonetTransportLabel(meta);
        return label ? `${message} — ${label}` : message;
    }

    // GDACS (fallback provider) status: provenance badge + data/fetch ages.
    function gdacsDetail(fallbackCount) {
        const status = fallbackProviders[0]?.getStatus?.();
        if (status?.state === 'on' && status.message) return { message: status.message, title: status.title || '' };
        return { message: `${fallbackCount} alerts`, title: '' };
    }

    function readFilters() {
        return {
            days: document.getElementById('daysFilter')?.value || '20',
            category: document.getElementById('categoryFilter')?.value || 'all',
            status: document.getElementById('statusFilter')?.value || 'open',
            dataSource: document.getElementById('dataSourceFilter')?.value || 'eonet',
            dataDay: getDataDay() || null
        };
    }

    /** The EONET window of a filter set (null in Live). */
    function windowFor(filters) {
        if (!filters?.dataDay) return null;
        const resolved = capability.resolve(filters.dataDay);
        return resolved.available ? resolved.window : null;
    }

    function buildUrl(filters = readFilters()) {
        return buildEonetUrl(apiUrl, { ...filters, window: windowFor(filters) }, { limit });
    }

    async function fetchNasaEvents(filters = readFilters(), { forceRefresh = false } = {}) {
        if (disposed) throw new DOMException('EONET data source disposed', 'AbortError');
        // One EONET request in flight: a newer load (another day) cancels it.
        nasaController?.abort();
        const controller = new AbortController();
        nasaController = controller;
        activeControllers.add(controller);
        const generation = ++nasaGeneration;
        const window = windowFor(filters);
        try {
            const result = await fetchEonet(buildUrl(filters), {
                ...filters,
                window,
                limit,
                signal: controller.signal,
                timeout: timeoutMs,
                forceRefresh
            });
            if (generation !== nasaGeneration) throw new DOMException('Superseded EONET request', 'AbortError');
            const data = result.data;
            const events = (data.events || [])
                .map(normalizeEventGeometry)
                .map(event => clipEventToWindow(event, window))
                .filter(Boolean)
                .filter(latestGeometry)
                .map(event => ({
                    ...event,
                    sourceProvider: event.sourceProvider || 'NASA EONET',
                    sourceMode: 'primary',
                    sourceUrl: event.sources?.[0]?.url || apiUrl,
                    sourceUpdatedAt: latestGeometry(event)?.date || event.geometry?.[0]?.date || '',
                    sourceConfidence: 'NASA near real-time event metadata'
                }));
            Object.defineProperty(events, 'transportMeta', { value: result.meta, enumerable: false });
            Object.defineProperty(events, 'window', { value: window, enumerable: false });
            return events;
        } finally {
            activeControllers.delete(controller);
            if (nasaController === controller) nasaController = null;
        }
    }

    // A historical day: EONET for the window; GDACS (live-only) is never used
    // as a fallback for the past; FIRMS/USGS decide for themselves.
    // Providers that would delay the day (FIRMS: one world day through the
    // proxy) run on their own: the pipeline returns EONET/USGS without them,
    // and their events arrive through onDeferredEvents for the same day only.
    function startDeferredProviders(filters) {
        const token = ++deferredGeneration;
        const deferred = supplementalProviders.filter(provider => provider.deferInHistory);
        if (!deferred.length) return;
        Promise.allSettled(deferred.map(provider => provider.fetchEvents(filters))).then(results => {
            if (disposed || token !== deferredGeneration) return;
            const events = results
                .filter(result => result.status === 'fulfilled')
                .flatMap(result => result.value || [])
                .filter(latestGeometry);
            onDeferredEvents({ day: filters.dataDay, events });
        });
    }

    async function fetchHistoricalEvents(filters, { forceRefresh = false } = {}) {
        startDeferredProviders(filters);
        const sourceMode = filters.dataSource || 'eonet';
        const day = filters.dataDay;
        const resolved = capability.resolve(day);
        if (sourceMode === 'gdacs') {
            const supplementalEvents = await fetchSupplementalEvents(filters, { excludeDeferred: true });
            onSourceStateChange({
                mode: sourceMode,
                activeProvider: 'GDACS',
                state: 'unavailable',
                message: `Data source: GDACS only — ${gdacsCapability.unavailableMessage(day)}`,
                title: ''
            });
            return dedupeEvents(supplementalEvents).filter(latestGeometry);
        }
        if (!resolved.available) {
            const supplementalEvents = await fetchSupplementalEvents(filters, { excludeDeferred: true });
            onSourceStateChange({
                mode: sourceMode,
                activeProvider: 'NASA EONET',
                state: 'unavailable',
                message: `Data source: NASA EONET — ${capability.unavailableMessage(day, resolved.reason)}`,
                title: ''
            });
            return dedupeEvents(supplementalEvents).filter(latestGeometry);
        }
        onSourceStateChange({
            mode: sourceMode,
            activeProvider: 'NASA EONET',
            state: 'refreshing',
            message: formatLoadingDay('Data source: NASA EONET', day),
            title: ''
        });
        const [nasaResult, supplementalEvents] = await Promise.all([
            fetchNasaEvents(filters, { forceRefresh }).then(value => ({ value }), error => ({ error })),
            fetchSupplementalEvents(filters, { excludeDeferred: true })
        ]);
        if (nasaResult.error?.name === 'AbortError') throw nasaResult.error;
        const nasaEvents = nasaResult.value || [];
        const events = dedupeEvents([...nasaEvents, ...supplementalEvents]).filter(latestGeometry);
        if (nasaResult.error) {
            onSourceStateChange({
                mode: sourceMode,
                activeProvider: 'NASA EONET',
                state: 'error',
                message: `Data source: NASA EONET failed for ${resolved.window.start}..${resolved.window.end} - ${nasaResult.error.message}`,
                title: ''
            });
            if (!events.length) throw nasaResult.error;
            return events;
        }
        const historical = composeHistoricalStatus({
            sourceKey: 'eonet',
            source: 'NASA EONET',
            window: resolved.window,
            count: nasaEvents.length,
        });
        onSourceStateChange({
            mode: sourceMode,
            activeProvider: 'NASA EONET',
            state: 'on',
            message: `Data source: ${historical.message}`,
            title: historical.title
        });
        return events;
    }

    async function fetchSupplementalEvents(filters, { excludeDeferred = false } = {}) {
        const providers = excludeDeferred
            ? supplementalProviders.filter(provider => !provider.deferInHistory)
            : supplementalProviders;
        const supplementalResults = await Promise.allSettled(
            providers.map(provider => provider.fetchEvents(filters))
        );
        return supplementalResults
            .filter(result => result.status === 'fulfilled')
            .flatMap(result => result.value || []);
    }

    async function fetchFallbackEvents(filters, mode = 'fallback') {
        const fallbackResults = await Promise.allSettled(
            fallbackProviders.map(provider => provider.fetchEvents(filters))
        );
        const events = fallbackResults
            .filter(result => result.status === 'fulfilled')
            .flatMap(result => result.value || [])
            .map(event => ({ ...event, sourceMode: mode }));
        const firstError = fallbackResults.find(result => result.status === 'rejected')?.reason || null;
        return { events, error: firstError };
    }

    function newestEventTime(events) {
        return events.reduce((newest, event) => {
            const date = latestGeometry(event)?.date || event.geometry?.[0]?.date;
            const time = date ? new Date(date).getTime() : NaN;
            return Number.isFinite(time) ? Math.max(newest, time) : newest;
        }, 0);
    }

    function dedupeEvents(events) {
        const seen = new Set();
        return events.filter(event => {
            const geom = latestGeometry(event);
            const [lon = 0, lat = 0] = geom?.coordinates || [];
            const day = (geom?.date || '').slice(0, 10);
            const title = String(event.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 48);
            const key = `${eventCategory(event)}:${day}:${Number(lat).toFixed(1)}:${Number(lon).toFixed(1)}:${title}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function readableError(error, provider = 'source') {
        if (!error) return 'no alerts';
        if (error.name === 'AbortError') return `${provider} request timed out`;
        return error.message || `${provider} network error`;
    }

    async function fetchEvents(filters = readFilters(), { forceRefresh = false } = {}) {
        if (disposed) throw new DOMException('EONET data source disposed', 'AbortError');
        const sourceMode = filters.dataSource || 'eonet';
        if (filters.dataDay) return fetchHistoricalEvents(filters, { forceRefresh });
        deferredGeneration += 1; // Live: a pending historical FIRMS result is stale

        if (sourceMode === 'gdacs') {
            if (isPublicProxyDisabledRuntime()) {
                onSourceStateChange({
                    mode: sourceMode,
                    activeProvider: 'GDACS',
                    state: 'off',
                    message: `Data source: GDACS only - ${proxyRequiredMessage('GDACS')}`
                });
                return [];
            }
            const fallback = await fetchFallbackEvents(filters, 'primary');
            // FIRMS (incendii) e un layer separat, paralel - trebuie sa functioneze
            // indiferent de alegerea EONET/GDACS ca sursa principala de evenimente,
            // nu doar in modurile 'eonet'/'smart'. Fara asta, toggle-ul FIRMS raminea
            // agatat pe "loading" la infinit cat timp sursa era setata pe 'gdacs'.
            const supplementalEvents = await fetchSupplementalEvents(filters);
            const combined = dedupeEvents([...fallback.events, ...supplementalEvents]).filter(latestGeometry);
            const alertCount = fallback.events.length;
            const gdacsOnly = () => {
                const detail = gdacsDetail(alertCount);
                return { message: `Data source: GDACS only - ${detail.message}`, title: detail.title };
            };
            onSourceStateChange({
                mode: sourceMode,
                activeProvider: 'GDACS',
                state: alertCount ? 'on' : fallback.error ? 'error' : 'off',
                ...(alertCount
                    ? { ...gdacsOnly(), recompose: gdacsOnly }
                    : { message: `Data source: GDACS only - ${readableError(fallback.error, 'GDACS')}`, title: '' })
            });
            if (!combined.length && fallback.error) throw fallback.error;
            return combined;
        }

        const nasaResult = await Promise.allSettled([fetchNasaEvents(filters, { forceRefresh })]);
        const nasaEvents = nasaResult[0].status === 'fulfilled' ? nasaResult[0].value : [];
        const nasaError = nasaResult[0].status === 'rejected' ? nasaResult[0].reason : null;
        // Superseded by a newer load: that load reports the status, not this one.
        if (nasaError?.name === 'AbortError') throw nasaError;
        const nasaTransport = nasaEvents.transportMeta || null;
        const supplementalEvents = await fetchSupplementalEvents(filters);

        if (sourceMode === 'smart') {
            if (isPublicProxyDisabledRuntime()) {
                const events = dedupeEvents([...nasaEvents, ...supplementalEvents]).filter(latestGeometry);
                onSourceStateChange({
                    mode: sourceMode,
                    activeProvider: 'NASA EONET',
                    state: nasaError ? 'error' : 'on',
                    message: nasaError
                        ? `Data source: public demo - NASA EONET failed; GDACS fallback needs proxy (${nasaError.message})`
                        : withTransport(`Data source: public demo - NASA EONET (${nasaEvents.length} events); GDACS fallback needs proxy`, nasaTransport)
                });
                if (!events.length && nasaError) throw nasaError;
                return events;
            }
            const newest = newestEventTime(nasaEvents);
            const stale = !newest || (Date.now() - newest > staleThresholdMs);
            if (nasaError || !nasaEvents.length || stale) {
                const fallback = await fetchFallbackEvents(filters, 'fallback');
                const primaryEvents = fallback.events.length ? fallback.events : nasaEvents;
                const combined = dedupeEvents([...primaryEvents, ...supplementalEvents]).filter(latestGeometry);
                const alertCount = fallback.events.length;
                const smartGdacs = () => {
                    const detail = gdacsDetail(alertCount);
                    return { message: `Data source: smart fallback - GDACS active (${detail.message})`, title: detail.title };
                };
                onSourceStateChange({
                    mode: sourceMode,
                    activeProvider: alertCount ? 'GDACS' : 'NASA EONET',
                    state: alertCount ? 'on' : nasaError ? 'error' : 'stale',
                    ...(alertCount
                        ? { ...smartGdacs(), recompose: smartGdacs }
                        : { message: withTransport(`Data source: smart fallback - ${nasaEvents.length ? 'using stale NASA EONET, GDACS unavailable' : readableError(nasaError || fallback.error, 'GDACS')}`, nasaTransport), title: '' })
                });
                if (!combined.length && nasaError) throw nasaError;
                return combined;
            }
        }

        const events = dedupeEvents([...nasaEvents, ...supplementalEvents]).filter(latestGeometry);
        const newestNasa = newestEventTime(nasaEvents);
        const eonetCount = nasaEvents.length;
        // Recalculat la fiecare re-randare (varsta relativa nu ramane inghetata).
        const eonetDefault = () => composeSourceStatus({
            sourceKey: 'eonet',
            message: `Data source: NASA EONET default - ${eonetCount} NASA events`,
            dataTime: newestNasa ? new Date(newestNasa).toISOString() : null,
            fetchedAt: nasaTransport?.updated || null,
            fetchState: fetchStateFromRuntime({ state: nasaTransport?.freshness === 'stale' ? 'stale' : 'live', meta: nasaTransport }),
        });
        onSourceStateChange({
            mode: sourceMode,
            activeProvider: 'NASA EONET',
            state: nasaError ? 'error' : nasaTransport?.freshness === 'stale' ? 'stale' : 'on',
            ...(nasaError
                ? { message: `Data source: NASA EONET failed - ${nasaError.message}`, title: '' }
                : { ...eonetDefault(), recompose: eonetDefault })
        });
        if (!events.length && nasaError) throw nasaError;
        return events;
    }

    function filterEvents(events, filters = readFilters()) {
        return filters.category === 'all'
            ? events
            : events.filter(event => eventCategory(event) === filters.category);
    }

    function formatLoadError(err) {
        const sourceMode = readFilters().dataSource;
        if (sourceMode === 'gdacs') {
            return err.name === 'AbortError'
                ? 'GDACS request timed out. Try refreshing.'
                : `GDACS load failed: ${err.message}`;
        }
        return err.name === 'AbortError'
            ? 'NASA EONET request timed out. Try refreshing.'
            : `NASA EONET load failed: ${err.message}`;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        for (const controller of activeControllers) controller.abort();
        activeControllers.clear();
        nasaController = null;
        nasaGeneration += 1;
        deferredGeneration += 1;
        supplementalProviders.forEach(provider => provider.dispose?.());
        fallbackProviders.forEach(provider => provider.dispose?.());
    }

    return {
        readFilters,
        buildUrl,
        fetchEvents,
        filterEvents,
        formatLoadError,
        dispose
    };
}

export function createEonetAutoRefreshController({
    intervalMs = 10 * 60 * 1000,
    refresh,
    onStateChange = () => {},
    now = () => Date.now()
}) {
    let enabled = false;
    let running = false;
    let timer = null;
    let lastRefresh = null;
    let lastError = null;
    let nextRefresh = null;

    function emit() {
        onStateChange({
            enabled,
            running,
            lastRefresh,
            lastError,
            nextRefresh,
            intervalMs
        });
    }

    function clearTimer() {
        if (timer) clearTimeout(timer);
        timer = null;
    }

    function schedule() {
        clearTimer();
        if (!enabled) {
            nextRefresh = null;
            emit();
            return;
        }
        nextRefresh = now() + intervalMs;
        timer = setTimeout(run, intervalMs);
        emit();
    }

    async function run() {
        if (!enabled || running) return;
        running = true;
        emit();
        try {
            await refresh();
            lastRefresh = now();
            lastError = null;
        } catch (err) {
            lastError = err;
        } finally {
            running = false;
            schedule();
        }
    }

    function setEnabled(value) {
        enabled = Boolean(value);
        schedule();
    }

    function toggle() {
        setEnabled(!enabled);
    }

    function dispose() {
        clearTimer();
        enabled = false;
        nextRefresh = null;
        emit();
    }

    emit();

    return {
        setEnabled,
        toggle,
        dispose,
        state: () => ({ enabled, running, lastRefresh, nextRefresh, intervalMs })
    };
}
