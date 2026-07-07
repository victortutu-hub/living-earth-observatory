export function createEonetDataSource({
    apiUrl,
    latestGeometry,
    eventCategory,
    timeoutMs = 15000,
    limit = 250,
    supplementalProviders = [],
    fallbackProviders = [],
    staleThresholdMs = 48 * 3600000,
    onSourceStateChange = () => {}
}) {
    function readFilters() {
        return {
            days: document.getElementById('daysFilter')?.value || '20',
            category: document.getElementById('categoryFilter')?.value || 'all',
            status: document.getElementById('statusFilter')?.value || 'open',
            dataSource: document.getElementById('dataSourceFilter')?.value || 'eonet'
        };
    }

    function buildUrl(filters = readFilters()) {
        const params = new URLSearchParams({
            status: filters.status,
            days: filters.days,
            limit: String(limit)
        });
        if (filters.category && filters.category !== 'all') params.set('category', filters.category);
        return `${apiUrl}?${params.toString()}`;
    }

    async function fetchNasaEvents(filters = readFilters()) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(buildUrl(filters), { signal: controller.signal });
            if (!res.ok) throw new Error(`NASA EONET returned ${res.status}`);
            const data = await res.json();
            return (data.events || [])
                .filter(latestGeometry)
                .map(event => ({
                    ...event,
                    sourceProvider: event.sourceProvider || 'NASA EONET',
                    sourceMode: 'primary',
                    sourceUrl: event.sources?.[0]?.url || apiUrl,
                    sourceUpdatedAt: latestGeometry(event)?.date || event.geometry?.[0]?.date || '',
                    sourceConfidence: 'NASA near real-time event metadata'
                }));
        } finally {
            clearTimeout(timeout);
        }
    }

    async function fetchSupplementalEvents(filters) {
        const supplementalResults = await Promise.allSettled(
            supplementalProviders.map(provider => provider.fetchEvents(filters))
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

    async function fetchEvents(filters = readFilters()) {
        const sourceMode = filters.dataSource || 'eonet';

        if (sourceMode === 'gdacs') {
            const fallback = await fetchFallbackEvents(filters, 'primary');
            // FIRMS (incendii) e un layer separat, paralel - trebuie sa functioneze
            // indiferent de alegerea EONET/GDACS ca sursa principala de evenimente,
            // nu doar in modurile 'eonet'/'smart'. Fara asta, toggle-ul FIRMS raminea
            // agatat pe "loading" la infinit cat timp sursa era setata pe 'gdacs'.
            const supplementalEvents = await fetchSupplementalEvents(filters);
            const combined = dedupeEvents([...fallback.events, ...supplementalEvents]).filter(latestGeometry);
            onSourceStateChange({
                mode: sourceMode,
                activeProvider: 'GDACS',
                state: fallback.events.length ? 'on' : fallback.error ? 'error' : 'off',
                message: fallback.events.length
                    ? `Data source: GDACS only - ${fallback.events.length} alerts`
                    : `Data source: GDACS only - ${readableError(fallback.error, 'GDACS')}`
            });
            if (!combined.length && fallback.error) throw fallback.error;
            return combined;
        }

        const nasaResult = await Promise.allSettled([fetchNasaEvents(filters)]);
        const nasaEvents = nasaResult[0].status === 'fulfilled' ? nasaResult[0].value : [];
        const nasaError = nasaResult[0].status === 'rejected' ? nasaResult[0].reason : null;
        const supplementalEvents = await fetchSupplementalEvents(filters);

        if (sourceMode === 'smart') {
            const newest = newestEventTime(nasaEvents);
            const stale = !newest || (Date.now() - newest > staleThresholdMs);
            if (nasaError || !nasaEvents.length || stale) {
                const fallback = await fetchFallbackEvents(filters, 'fallback');
                const primaryEvents = fallback.events.length ? fallback.events : nasaEvents;
                const combined = dedupeEvents([...primaryEvents, ...supplementalEvents]).filter(latestGeometry);
                onSourceStateChange({
                    mode: sourceMode,
                    activeProvider: fallback.events.length ? 'GDACS' : 'NASA EONET',
                    state: fallback.events.length ? 'on' : nasaError ? 'error' : 'stale',
                    message: fallback.events.length
                        ? `Data source: smart fallback - GDACS active (${fallback.events.length} alerts)`
                        : `Data source: smart fallback - ${nasaEvents.length ? 'using stale NASA EONET, GDACS unavailable' : readableError(nasaError || fallback.error, 'GDACS')}`
                });
                if (!combined.length && nasaError) throw nasaError;
                return combined;
            }
        }

        const events = dedupeEvents([...nasaEvents, ...supplementalEvents]).filter(latestGeometry);
        onSourceStateChange({
            mode: sourceMode,
            activeProvider: 'NASA EONET',
            state: nasaError ? 'error' : 'on',
            message: nasaError
                ? `Data source: NASA EONET failed - ${nasaError.message}`
                : `Data source: NASA EONET default - ${nasaEvents.length} NASA events`
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

    return {
        readFilters,
        buildUrl,
        fetchEvents,
        filterEvents,
        formatLoadError
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
