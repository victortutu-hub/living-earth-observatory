// LOT 11 — past days of the wind (ERA5) and ocean-current (SMOC) layers.
// The proxy (wind-day / currents-day) returns a whole UTC day on the live
// 10 degree grid: speed in m/s and direction in degrees per hour, null where
// there is no value (land for currents). The client fetches a day once
// through dataBroker and picks the scene hour locally; direction -> u/v stays
// in the existing provider encoders (wind "from", currents "towards").
import { isPublicProxyDisabledRuntime, proxyRequiredMessage } from './public-runtime.js';
import { fetchEarthFieldDay } from './earth-data-runtime.js';

export const FIELD_DAY_SOURCES = Object.freeze({
    wind: Object.freeze({ proxySource: 'wind-day', label: 'Wind', notPublished: 'not yet published by the source' }),
    currents: Object.freeze({ proxySource: 'currents-day', label: 'Ocean currents', notPublished: 'not yet published by the source' }),
});

function readProxyBase() {
    const params = new URLSearchParams(window.location.search);
    return params.get('proxyBase') || window.NASA_PROXY_BASE || 'http://127.0.0.1:8787';
}

export function fieldDayUrl(layer, day, proxyBase = readProxyBase()) {
    return `${proxyBase}/nasa-proxy?${new URLSearchParams({ source: FIELD_DAY_SOURCES[layer].proxySource, date: day })}`;
}

/** Scene time -> hour of its UTC day, rounded to the nearest hour (23 at most). */
export function sceneHourOf(date) {
    const d = date instanceof Date ? date : new Date(date);
    return Math.min(23, Math.round(d.getUTCHours() + d.getUTCMinutes() / 60));
}

/** Proxy envelope -> { status: 'ok', payload, proxyStatus } | { status: 'queued', retryAfterS }. */
export function interpretFieldDayEnvelope(envelope) {
    if (envelope?.proxyStatus === 'queued') return { status: 'queued', retryAfterS: Math.max(1, Number(envelope.retryAfterS) || 30) };
    const payload = envelope?.data;
    if (!payload || !Array.isArray(payload.speed) || !Array.isArray(payload.direction) || !payload.grid) {
        throw Object.assign(new Error('unexpected proxy payload'), { fieldDayKind: 'proxy' });
    }
    return { status: 'ok', payload, proxyStatus: envelope.proxyStatus || null };
}

/**
 * Error of a day request -> what the status says.
 *   not-published (404) | rate-limited (429, retryAfterS) | proxy (other HTTP) | unreachable
 */
export function classifyFieldDayError(error) {
    if (error?.fieldDayKind === 'proxy-required') return { kind: 'proxy-required', text: error.message };
    // requestRuntime wraps the HTTP error (RuntimeRequestError.cause).
    const status = error?.status ?? error?.cause?.status;
    const retryAfter = error?.retryAfter ?? error?.cause?.retryAfter;
    if (status === 404) return { kind: 'not-published' };
    if (status === 429) {
        const retryAfterS = Number.isFinite(retryAfter) ? Math.max(1, Math.ceil(retryAfter / 1000)) : 60;
        return { kind: 'rate-limited', retryAfterS };
    }
    if (status >= 400 || error?.fieldDayKind === 'proxy') return { kind: 'proxy', text: status ? `proxy returned ${status}` : 'unexpected proxy answer' };
    return { kind: 'unreachable', text: 'proxy unreachable' };
}

/**
 * Fetches one UTC day for `layer` ('wind' | 'currents') through dataBroker
 * (earth:wind:day:<day> / earth:currents:day:<day>). A queued answer is not a
 * result: the caller retries after retryAfterS with forceRefresh.
 */
export async function fetchFieldDay(layer, { day, signal = null, forceRefresh = false, timeout = 20_000 } = {}) {
    if (isPublicProxyDisabledRuntime()) {
        throw Object.assign(new Error(proxyRequiredMessage(FIELD_DAY_SOURCES[layer].label)), { fieldDayKind: 'proxy-required' });
    }
    const url = fieldDayUrl(layer, day);
    const result = await fetchEarthFieldDay(layer, url, { day, signal, forceRefresh, timeout });
    const outcome = interpretFieldDayEnvelope(result.data);
    // A cached "queued" envelope is not a result: ask the proxy again once.
    if (outcome.status === 'queued' && !forceRefresh) {
        return interpretFieldDayEnvelope((await fetchEarthFieldDay(layer, url, { day, signal, forceRefresh: true, timeout })).data);
    }
    return outcome;
}

/**
 * Day/hour selection of one field layer, without WebGL (testable):
 *   - a new day: one request in flight (AbortController + generation), the
 *     previous field is hidden until the new day is applied;
 *   - the same day, another hour: a new texture from the loaded day, no request;
 *   - "queued" at the data source: one owned retry timer, after retryAfterS;
 *   - dispose()/cancel(): aborts, clears the timer; late answers are dropped.
 * fetchDay({ day, signal, forceRefresh }) -> { status: 'ok', payload } | { status: 'queued', retryAfterS }
 * buildTexture(payload, hour) -> texture; applyTexture(texture) owns and frees the previous one.
 */
export function createFieldDayController({ fetchDay, buildTexture, applyTexture, hide = () => {}, timers = null }) {
    const setTimer = timers?.setTimeout || setTimeout;
    const clearTimer = timers?.clearTimeout || clearTimeout;
    let selection = { day: null, hour: 0 };
    let loaded = null;       // { day, payload, proxyStatus }
    let shownHour = null;
    let pending = null;      // { day, kind: 'loading' | 'queued', retryAfterS }
    let error = null;        // { day, kind, ... }
    let controller = null;
    let retryTimer = null;
    let generation = 0;
    let disposed = false;

    function cancel() {
        generation += 1;
        controller?.abort();
        controller = null;
        if (retryTimer !== null) clearTimer(retryTimer);
        retryTimer = null;
        pending = null;
    }

    function showHour(hour) {
        if (!loaded) return;
        const h = Math.max(0, Math.min((loaded.payload.times?.length || 24) - 1, Number(hour) || 0));
        if (h === shownHour) return;
        applyTexture(buildTexture(loaded.payload, h));
        shownHour = h;
    }

    async function load(day, { forceRefresh = false } = {}) {
        cancel();
        const current = generation;
        const own = new AbortController();
        controller = own;
        pending = { day, kind: 'loading' };
        error = null;
        try {
            const outcome = await fetchDay({ day, signal: own.signal, forceRefresh });
            if (disposed || current !== generation) return;
            if (outcome.status === 'queued') {
                pending = { day, kind: 'queued', retryAfterS: outcome.retryAfterS };
                retryTimer = setTimer(() => {
                    retryTimer = null;
                    if (!disposed && selection.day === day) load(day, { forceRefresh: true });
                }, outcome.retryAfterS * 1000);
                return;
            }
            pending = null;
            loaded = { day, payload: outcome.payload, proxyStatus: outcome.proxyStatus || null };
            shownHour = null;
            showHour(selection.hour);
        } catch (failure) {
            if (disposed || current !== generation || failure?.name === 'AbortError') return;
            pending = null;
            error = { day, ...classifyFieldDayError(failure) };
        } finally {
            if (controller === own) controller = null;
        }
    }

    /**
     * Select a day (UTC) and an hour; day null leaves history mode. A day in
     * error is retried only on request (retryError: re-enabling the layer),
     * never by a mere change of hour.
     */
    function select({ day = null, hour = 0 } = {}, { retryError = false } = {}) {
        if (disposed) return;
        selection = { day: day || null, hour: Number(hour) || 0 };
        if (!selection.day) { cancel(); return; }
        if (loaded?.day === selection.day) { showHour(selection.hour); return; }
        if (pending?.day === selection.day) return; // already loading / queued
        if (error?.day === selection.day && !retryError) return;
        hide();
        load(selection.day);
    }

    function state() {
        const day = selection.day;
        if (!day) return { day: null };
        if (pending?.day === day) return { day, kind: pending.kind, retryAfterS: pending.retryAfterS };
        if (error?.day === day) return { day, kind: 'error', error };
        if (loaded?.day === day) return { day, kind: 'ready', hour: shownHour, time: loaded.payload.times?.[shownHour] || null, proxyStatus: loaded.proxyStatus };
        return { day, kind: 'idle' };
    }

    function dispose() {
        disposed = true;
        cancel();
    }

    return {
        select,
        cancel,
        state,
        dispose,
        // Re-show the loaded hour after the layer was hidden and enabled again.
        reshow() { if (loaded && loaded.day === selection.day) { const h = selection.hour; shownHour = null; showHour(h); } },
        get selection() { return { ...selection }; },
    };
}

/** Frees a field texture and its NEAREST land mask (ocean currents). */
export function disposeFieldTexture(texture) {
    if (!texture) return;
    texture.userData?.maskTexture?.dispose?.();
    texture.dispose?.();
}

/**
 * Swaps the field used by the particle compute (uFieldMap, uMaxSpeed) and the
 * trail points (mask or field), then frees the previous texture. Returns it.
 */
export function swapFieldTexture({ computeUniforms, pointUniforms }, texture) {
    const previous = computeUniforms.uFieldMap.value;
    computeUniforms.uFieldMap.value = texture;
    computeUniforms.uMaxSpeed.value = texture.userData.maxSpeedMs;
    pointUniforms.uFieldMap.value = texture.userData.maskTexture || texture;
    if (previous && previous !== texture) disposeFieldTexture(previous);
    return previous;
}

/** Samples of one hour of a day payload, in grid order: { speed (m/s), direction (deg) } or nulls. */
export function hourSamples(payload, hour) {
    const count = payload.grid.width * payload.grid.height;
    const h = Math.max(0, Math.min((payload.times?.length || 24) - 1, Number(hour) || 0));
    const offset = h * count;
    return {
        count,
        hour: h,
        time: payload.times?.[h] || null,
        sample: (index) => ({ speed: payload.speed[offset + index], direction: payload.direction[offset + index] }),
    };
}
