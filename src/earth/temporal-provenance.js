// Temporal provenance is deliberately separate from a source's scientific
// provenance.  Scene time controls astronomy; source time belongs to data;
// loadedAt only records transport/cache activity.  Keeping this tiny contract
// here lets existing layer/status surfaces describe that distinction without a
// second runtime or provider abstraction.
import { describeSourceProvenance } from '../config/source-registry.js';

export const TEMPORAL_TYPES = Object.freeze([
    'physical-model',
    'observed',
    'observed-derived',
    'historical-catalog',
    'static-reference',
    'procedural'
]);

export const SCENE_TIME_COMPATIBILITY = Object.freeze(['yes', 'latest-only', 'static', 'unknown']);
export const CACHE_STATES = Object.freeze(['fresh', 'stale', 'fallback', 'unknown']);

const VALID_TYPES = new Set(TEMPORAL_TYPES);
const VALID_COMPATIBILITY = new Set(SCENE_TIME_COMPATIBILITY);
const VALID_CACHE_STATES = new Set(CACHE_STATES);

function validTimestamp(value) {
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function createTemporalDescriptor({
    temporalType,
    sourceTime = null,
    sceneTimeCompatibility = 'unknown',
    loadedAt = null,
    cacheState = 'unknown',
    fallbackReason = null,
} = {}) {
    if (!VALID_TYPES.has(temporalType)) throw new TypeError(`Unknown temporal type: ${temporalType}`);
    if (!VALID_COMPATIBILITY.has(sceneTimeCompatibility)) throw new TypeError(`Unknown scene-time compatibility: ${sceneTimeCompatibility}`);
    if (!VALID_CACHE_STATES.has(cacheState)) throw new TypeError(`Unknown cache state: ${cacheState}`);
    return Object.freeze({
        temporalType,
        sourceTime: validTimestamp(sourceTime),
        sceneTimeCompatibility,
        loadedAt: validTimestamp(loadedAt),
        cacheState,
        fallbackReason: fallbackReason || null,
    });
}

export const EARTH_TEMPORAL_LAYERS = Object.freeze({
    sun: createTemporalDescriptor({ temporalType: 'physical-model', sceneTimeCompatibility: 'yes' }),
    moon: createTemporalDescriptor({ temporalType: 'physical-model', sceneTimeCompatibility: 'yes' }),
    blueMarble: createTemporalDescriptor({ temporalType: 'static-reference', sceneTimeCompatibility: 'static' }),
    blackMarble: createTemporalDescriptor({ temporalType: 'observed', sourceTime: '2016-01-01T00:00:00Z', sceneTimeCompatibility: 'static' }),
    etopo: createTemporalDescriptor({ temporalType: 'static-reference', sceneTimeCompatibility: 'static' }),
    clouds: createTemporalDescriptor({ temporalType: 'procedural', sceneTimeCompatibility: 'static' }),
    snowIce: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'latest-only' }),
    eonet: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'latest-only' }),
    usgs: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'latest-only' }),
    firms: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'latest-only' }),
    aurora: createTemporalDescriptor({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' }),
    wind: createTemporalDescriptor({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' }),
    oceanCurrents: createTemporalDescriptor({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' }),
    gvp: createTemporalDescriptor({ temporalType: 'historical-catalog', sceneTimeCompatibility: 'static' }),
    iss: createTemporalDescriptor({ temporalType: 'physical-model', sceneTimeCompatibility: 'yes' }),
});

function formatUtc(iso) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(iso)).replace(',', '') + ' UTC';
}

// The default label is neutral on purpose: scientific provenance (Observed,
// Model prediction, ...) comes from the source registry, never from this badge.
export function formatTemporalBadge(descriptor, { sourceLabel = 'Source time' } = {}) {
    const temporal = createTemporalDescriptor(descriptor);
    if (temporal.temporalType === 'procedural') return temporal.cacheState === 'fallback' ? 'Procedural fallback' : 'Procedural';
    if (temporal.temporalType === 'static-reference') return 'Static reference';
    if (temporal.temporalType === 'historical-catalog') return 'Historical catalog';
    const parts = [temporal.sourceTime ? `${sourceLabel} · ${formatUtc(temporal.sourceTime)}` : `${sourceLabel} · source time unavailable`];
    if (temporal.cacheState === 'stale') parts.push('stale');
    else if (temporal.cacheState === 'fallback') parts.push('fallback');
    return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Data time vs fetch time. "Data time" belongs to the source (satellite
// acquisition, model valid time, newest event); "fetched" is when the response
// was obtained (proxyFetchedAt for proxied sources, response time otherwise).
// Ages are computed from timestamps at render time, never stored as text.
// ---------------------------------------------------------------------------

export const FETCH_STATES = Object.freeze(['live', 'cache', 'proxy-cache', 'stale']);

export function formatUtcTimestamp(value) {
    const iso = validTimestamp(value);
    return iso ? formatUtc(iso) : null;
}

/** 'just now', '7 min ago', '3 h ago', '2 d ago'; future times read 'in 35 min'. */
export function formatRelativeAge(ageMs) {
    if (!Number.isFinite(ageMs)) return null;
    const future = ageMs < 0;
    const abs = Math.abs(ageMs);
    if (abs < 60_000) return 'just now';
    let amount;
    if (abs < 3_600_000) amount = `${Math.floor(abs / 60_000)} min`;
    else if (abs < 48 * 3_600_000) amount = `${Math.floor(abs / 3_600_000)} h`;
    else amount = `${Math.floor(abs / 86_400_000)} d`;
    return future ? `in ${amount}` : `${amount} ago`;
}

/** Maps the proxy envelope's proxyStatus to a fetch state. */
export function fetchStateFromProxyStatus(proxyStatus) {
    if (proxyStatus === 'cache-fresh') return 'proxy-cache';
    if (proxyStatus === 'stale-cache') return 'stale';
    return 'live';
}

/** Maps a requestRuntime result to a fetch state. */
export function fetchStateFromRuntime(result) {
    if (result?.state === 'stale') return 'stale';
    if (result?.meta?.cache === 'hit' || result?.meta?.cache === 'service-worker-cache') return 'cache';
    return 'live';
}

/**
 * Open-Meteo returns `current.time` as local wall time without an offset
 * ("2026-11-11T14:00") plus `utc_offset_seconds` (0 for the default GMT).
 */
export function parseOpenMeteoTime(time, utcOffsetSeconds = 0) {
    if (typeof time !== 'string' || !time) return null;
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(time);
    const base = Date.parse(hasZone ? time : `${time}Z`);
    if (!Number.isFinite(base)) return null;
    const offsetMs = hasZone ? 0 : (Number(utcOffsetSeconds) || 0) * 1000;
    return new Date(base - offsetMs).toISOString();
}

function fetchText(fetchState, age) {
    if (fetchState === 'proxy-cache') return `proxy cache, fetched ${age}`;
    if (fetchState === 'stale') return `stale — live fetch failed, fetched ${age}`;
    if (fetchState === 'cache') return `cached, fetched ${age}`;
    return `fetched ${age}`;
}

function fetchTitle(fetchState) {
    if (fetchState === 'proxy-cache') return 'proxy cache';
    if (fetchState === 'stale') return 'stale cache — live fetch failed';
    if (fetchState === 'cache') return 'browser cache';
    return 'live response';
}

/**
 * Status line for a data layer: provenance badge from the source registry,
 * the layer message, data age and fetch age. Returns { message, title }; the
 * title carries the provenance note and absolute UTC times for the tooltip.
 */
export function composeSourceStatus({
    sourceKey,
    message,
    dataTime = null,
    fetchedAt = null,
    fetchState = 'live',
    validAt = null,
    now = Date.now(),
}) {
    const provenance = describeSourceProvenance(sourceKey, { validAt });
    const parts = [];
    if (provenance) parts.push(provenance.label);
    parts.push(message);
    const titleLines = provenance ? [provenance.title] : [];

    const dataIso = validTimestamp(dataTime);
    if (dataIso) {
        parts.push(`data ${formatRelativeAge(now - Date.parse(dataIso))}`);
        titleLines.push(`Data time: ${formatUtc(dataIso)}`);
    } else {
        titleLines.push('Data time: unavailable from source');
    }

    const fetchedIso = validTimestamp(fetchedAt);
    if (fetchedIso) {
        parts.push(fetchText(fetchState, formatRelativeAge(now - Date.parse(fetchedIso))));
        titleLines.push(`Fetched: ${formatUtc(fetchedIso)} (${fetchTitle(fetchState)})`);
    } else if (fetchState === 'stale') {
        parts.push('stale — live fetch failed');
    }

    return { message: parts.join(' · '), title: titleLines.join('\n') };
}

/** Badge + tooltip for layers without fetched data (local models / shaders). */
export function composeProvenanceStatus(sourceKey, message, { extraTitle = '' } = {}) {
    const provenance = describeSourceProvenance(sourceKey);
    if (!provenance) return { message, title: extraTitle };
    return {
        message: `${provenance.label} · ${message}`,
        title: extraTitle ? `${provenance.title}\n${extraTitle}` : provenance.title,
    };
}
