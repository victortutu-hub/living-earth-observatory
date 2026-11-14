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

export const SCENE_TIME_COMPATIBILITY = Object.freeze(['yes', 'latest-only', 'date-selectable', 'static', 'unknown']);
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
    snowIce: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'date-selectable' }),
    eonet: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'date-selectable' }),
    usgs: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'date-selectable' }),
    firms: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'date-selectable' }),
    gdacs: createTemporalDescriptor({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' }),
    aurora: createTemporalDescriptor({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' }),
    wind: createTemporalDescriptor({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' }),
    oceanCurrents: createTemporalDescriptor({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' }),
    gvp: createTemporalDescriptor({ temporalType: 'historical-catalog', sceneTimeCompatibility: 'static' }),
    iss: createTemporalDescriptor({ temporalType: 'physical-model', sceneTimeCompatibility: 'yes' }),
});

// ---------------------------------------------------------------------------
// Time capability (LOT 5): what a layer can show for a chosen UTC day. This is
// separate from TEMPORAL_TYPES (the nature of the data): a capability says
// whether the app can request the layer for a past day, and over which range.
// A layer that cannot must say "not available for <day>" and hide; it never
// shows today's data as if it were from the past, and a missing day is never
// replaced by a neighbouring one.
// ---------------------------------------------------------------------------

export const TIME_CAPABILITY_KINDS = Object.freeze([
    'live-only',   // only the latest data is requested
    'daily',       // one product per UTC day (with gaps and a publication lag)
    'annual',      // one composite per listed year
    'event-range', // events inside a window of days ending on the chosen day
    'hourly',      // hourly fields
    'static',      // does not depend on the date (reference, procedural)
    'scene-model', // computed for the scene time itself (Sun, Moon)
]);

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const VALID_KINDS = new Set(TIME_CAPABILITY_KINDS);

/** UTC calendar day of a date, 'YYYY-MM-DD'. */
export function utcDay(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('utcDay requires a valid date.');
    return date.toISOString().slice(0, 10);
}

export function isUtcDay(value) {
    return typeof value === 'string' && ISO_DAY.test(value)
        && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
        && utcDay(`${value}T00:00:00Z`) === value;
}

/** day + n days, 'YYYY-MM-DD' (n may be negative). */
export function addUtcDays(day, n) {
    if (!isUtcDay(day)) throw new TypeError(`Invalid UTC day: ${day}`);
    return utcDay(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
}

/** Inclusive window of `days` UTC days ending on `day`: 7 -> [day-6, day]. */
export function eventWindow(day, days = 7) {
    const span = Math.max(1, Math.round(Number(days) || 1));
    return Object.freeze({ start: addUtcDays(day, -(span - 1)), end: day, days: span });
}

/** First and last instant of a window (the last day is included). */
export function windowInstants({ start, end }) {
    return {
        startMs: Date.parse(`${start}T00:00:00.000Z`),
        endMs: Date.parse(`${end}T23:59:59.999Z`),
    };
}

/** True when the whole window lies before today's UTC day minus `lagDays`. */
export function windowIsClosed({ end }, { today = utcDay(Date.now()), lagDays = 1 } = {}) {
    return end < addUtcDays(today, -lagDays);
}

const SHORT_MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' });
function dayParts(day) {
    const date = new Date(`${day}T00:00:00Z`);
    return { d: date.getUTCDate(), m: SHORT_MONTH.format(date), y: date.getUTCFullYear() };
}

/** '13 Nov 2025'. */
export function formatUtcDay(day) {
    const { d, m, y } = dayParts(day);
    return `${d} ${m} ${y}`;
}

/** '7–13 Nov 2025', '28 Oct – 3 Nov 2025', '29 Dec 2025 – 4 Jan 2026'. */
export function formatDayWindow({ start, end }) {
    if (start === end) return formatUtcDay(end);
    const a = dayParts(start);
    const b = dayParts(end);
    if (a.y !== b.y) return `${formatUtcDay(start)} – ${formatUtcDay(end)}`;
    if (a.m !== b.m) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
    return `${a.d}–${b.d} ${b.m} ${b.y}`;
}

const UNAVAILABLE_TEXT = Object.freeze({
    'before-range': 'before the source record starts',
    gap: 'no source data published for this day',
    lag: 'not yet published by the source',
    future: 'future date',
    'no-composite': 'no composite for this year',
});

/**
 * kind, range { start, end: 'latest' | day }, lagDays, gaps [[start, end]],
 * years (annual), windowDays (event-range), sourceLabel (live-only wording).
 * resolve(day, { today }) -> { available, live?, key?, day?, window?, reason? };
 * day === null means Live, always available (today's behaviour).
 */
export function createTimeCapability({
    kind,
    range = null,
    lagDays = 0,
    gaps = [],
    years = null,
    windowDays = 7,
    sourceLabel = 'live-only source',
    note = '',
} = {}) {
    if (!VALID_KINDS.has(kind)) throw new TypeError(`Unknown time capability kind: ${kind}`);
    if (range && (!isUtcDay(range.start) || !(range.end === 'latest' || isUtcDay(range.end)))) {
        throw new TypeError('A time capability range needs { start: day, end: day | "latest" }.');
    }
    if ((kind === 'daily' || kind === 'event-range' || kind === 'hourly') && !range) {
        throw new TypeError(`A ${kind} capability needs a range.`);
    }
    if (kind === 'annual' && !(Array.isArray(years) && years.length)) throw new TypeError('An annual capability needs years.');
    const frozenGaps = Object.freeze(gaps.map(([start, end]) => {
        if (!isUtcDay(start) || !isUtcDay(end) || start > end) throw new TypeError(`Invalid gap ${start}..${end}`);
        return Object.freeze([start, end]);
    }));
    const lag = Math.max(0, Math.round(Number(lagDays) || 0));
    const unavailable = (reason) => Object.freeze({ available: false, reason });

    function resolve(day, { today = utcDay(Date.now()) } = {}) {
        if (day == null) return Object.freeze({ available: true, live: true, key: 'live' });
        if (!isUtcDay(day)) throw new TypeError(`resolve() needs a UTC day (YYYY-MM-DD), got ${day}`);
        if (kind === 'live-only') return unavailable('live-only');
        if (kind === 'static') return Object.freeze({ available: true, key: 'static' });
        if (kind === 'scene-model') return Object.freeze({ available: true, key: day, day });
        if (day > today) return unavailable('future');
        if (kind === 'annual') {
            const year = Number(day.slice(0, 4));
            return years.includes(year)
                ? Object.freeze({ available: true, key: `${year}-01-01`, day: `${year}-01-01` })
                : unavailable('no-composite');
        }
        if (day < range.start) return unavailable('before-range');
        if (range.end === 'latest' ? day > addUtcDays(today, -lag) : day > range.end) {
            return unavailable(range.end === 'latest' ? 'lag' : 'before-range');
        }
        if (frozenGaps.some(([start, end]) => day >= start && day <= end)) return unavailable('gap');
        if (kind === 'event-range') {
            const window = eventWindow(day, windowDays);
            return Object.freeze({ available: true, key: `${window.start}/${window.end}`, day, window });
        }
        return Object.freeze({ available: true, key: day, day });
    }

    /** "Not available for 13 Nov 2025 — live-only source". */
    function unavailableMessage(day, reason = 'live-only') {
        const why = reason === 'live-only' ? sourceLabel : (UNAVAILABLE_TEXT[reason] || 'not available');
        return `Not available for ${formatUtcDay(day)} — ${why}`;
    }

    return Object.freeze({
        kind,
        range: range ? Object.freeze({ ...range }) : null,
        lagDays: lag,
        gaps: frozenGaps,
        years: years ? Object.freeze([...years]) : null,
        windowDays,
        sourceLabel,
        note,
        dateSelectable: kind === 'daily' || kind === 'annual' || kind === 'event-range',
        resolve,
        unavailableMessage,
    });
}

// MODIS Terra NDSI Snow Cover, from the GIBS WMTS GetCapabilities read on
// 2026-11-13: daily from 2000-02-24, with these gaps between published ranges.
const MODIS_TERRA_SNOW_GAPS = [
    ['2000-08-07', '2000-08-17'], ['2001-06-16', '2001-07-02'], ['2002-03-20', '2002-03-27'],
    ['2003-12-17', '2003-12-23'], ['2008-12-21', '2008-12-22'], ['2016-02-19', '2016-02-26'],
    ['2022-10-11', '2022-10-22'],
];

/**
 * One declaration per Earth layer (a test checks that none is missing). A
 * capability describes what this app does today, not what the upstream could
 * do: Open-Meteo has history for wind and currents, but no historical request
 * exists yet, so both are live-only.
 */
export const EARTH_TIME_CAPABILITIES = Object.freeze({
    sun: createTimeCapability({ kind: 'scene-model' }),
    moon: createTimeCapability({ kind: 'scene-model' }),
    blueMarble: createTimeCapability({ kind: 'static' }),
    blackMarble: createTimeCapability({ kind: 'static', note: 'Fixed 2016 annual composite, labelled with its year.' }),
    etopo: createTimeCapability({ kind: 'static' }),
    clouds: createTimeCapability({ kind: 'static', note: 'Procedural cloud layer.' }),
    dailyClouds: createTimeCapability({ kind: 'live-only', note: 'NASA GIBS daily VIIRS clouds; paused in the public control.' }),
    snowIce: createTimeCapability({ kind: 'daily', range: { start: '2000-02-24', end: 'latest' }, lagDays: 1, gaps: MODIS_TERRA_SNOW_GAPS }),
    eonet: createTimeCapability({ kind: 'event-range', range: { start: '2015-01-01', end: 'latest' }, windowDays: 7 }),
    usgs: createTimeCapability({ kind: 'event-range', range: { start: '1900-01-01', end: 'latest' }, windowDays: 7 }),
    // LOT 9: one UTC day through the proxy's firms-day route (MODIS NRT or SP);
    // the proxy enforces the real NRT/SP coverage and answers no-coverage.
    firms: createTimeCapability({ kind: 'daily', range: { start: '2000-11-01', end: 'latest' }, lagDays: 1 }),
    gdacs: createTimeCapability({ kind: 'live-only' }),
    aurora: createTimeCapability({ kind: 'live-only' }),
    wind: createTimeCapability({ kind: 'live-only' }),
    oceanCurrents: createTimeCapability({ kind: 'live-only' }),
    gvp: createTimeCapability({ kind: 'live-only', sourceLabel: 'current-catalog source', note: 'Catalog as published today; last eruption dates may be later than the chosen day.' }),
    iss: createTimeCapability({ kind: 'live-only', sourceLabel: 'live-only source (TLE valid only near its epoch)' }),
    airglow: createTimeCapability({ kind: 'static', note: 'Procedural.' }),
    zodiacalLight: createTimeCapability({ kind: 'static', note: 'Procedural.' }),
    noctilucentClouds: createTimeCapability({ kind: 'static', note: 'Procedural.' }),
});

/**
 * Historical status line: provenance badge, source, window and count, without
 * relative ages: "Observed · NASA EONET · events 7–13 Nov 2025 · 77 events".
 */
export function composeHistoricalStatus({ sourceKey, source, noun = 'events', window = null, day = null, count = null, unit = 'events' }) {
    const provenance = describeSourceProvenance(sourceKey);
    const when = window ? formatDayWindow(window) : formatUtcDay(day);
    const parts = [];
    if (provenance) parts.push(provenance.label);
    parts.push(source, `${noun} ${when}`);
    if (count != null) parts.push(unit ? `${count} ${unit}` : String(count));
    const requested = window ? `${window.start} .. ${window.end}` : day;
    return {
        message: parts.join(' · '),
        title: [provenance?.title, `Requested (UTC): ${requested}`].filter(Boolean).join('\n'),
    };
}

/** "USGS quakes: loading 13 Nov 2025…", shown while a day is in flight. */
export function formatLoadingDay(label, day) {
    return `${label}: loading ${formatUtcDay(day)}…`;
}

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
