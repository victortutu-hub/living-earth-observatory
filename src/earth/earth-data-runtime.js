import { dataBroker } from '../core/data-broker.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function latestEonetTimestamp(data) {
    let latest = null;
    for (const event of Array.isArray(data?.events) ? data.events : []) {
        const geometry = Array.isArray(event?.geometry) ? event.geometry[event.geometry.length - 1] : null;
        const date = geometry?.date;
        if (date && (!latest || Date.parse(date) > Date.parse(latest))) latest = date;
    }
    return latest;
}

function latestUsgsTimestamp(data) {
    const generated = Number(data?.metadata?.generated);
    if (Number.isFinite(generated)) return new Date(generated).toISOString();

    let latest = 0;
    for (const feature of Array.isArray(data?.features) ? data.features : []) {
        const timestamp = Number(feature?.properties?.updated ?? feature?.properties?.time);
        if (Number.isFinite(timestamp)) latest = Math.max(latest, timestamp);
    }
    return latest ? new Date(latest).toISOString() : null;
}

function ovationTimestamp(data) {
    const candidates = [
        data?.['Observation Time'],
        data?.ObservationTime,
        data?.observationTime,
        data?.timestamp,
        data?.time,
    ];
    return candidates.find(value => value && Number.isFinite(Date.parse(value))) || null;
}

function tleEpochTimestamp(text) {
    const line1 = String(text || '').split(/\r?\n/).find(line => line.trim().startsWith('1 '));
    const epoch = line1?.trim().split(/\s+/)[3];
    const match = /^(\d{2})(\d{3}(?:\.\d+)?)$/.exec(epoch || '');
    if (!match) return null;
    const shortYear = Number(match[1]);
    const year = shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear;
    const dayOfYear = Number(match[2]);
    if (!Number.isFinite(dayOfYear)) return null;
    return new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * DAY).toISOString();
}

function publish(sourceId, result) {
    dataBroker.publishRuntimeStatus(sourceId, result);
    return result;
}

async function run(sourceId, operation) {
    try {
        return publish(sourceId, await operation());
    } catch (error) {
        dataBroker.publishRuntimeError(sourceId, error);
        throw error;
    }
}

function normalizedPart(value, fallback = 'all') {
    return encodeURIComponent(String(value || fallback).toLowerCase());
}

// A window that ended before yesterday (UTC) no longer changes upstream, so its
// cached copy can be kept long; open windows keep the live TTLs.
const CLOSED_WINDOW_TTL = 7 * DAY;
const CLOSED_WINDOW_STALE_TTL = 30 * DAY;

/** Cache policy for a requested day window (null = Live). */
export function windowCachePolicy(window, { ttl, staleTtl, now = Date.now() } = {}) {
    if (!window) return { ttl, staleTtl, closed: false };
    const yesterday = new Date(now - DAY).toISOString().slice(0, 10);
    const closed = window.end < yesterday;
    return closed
        ? { ttl: CLOSED_WINDOW_TTL, staleTtl: CLOSED_WINDOW_STALE_TTL, closed: true }
        : { ttl, staleTtl, closed: false };
}

/** requestRuntime key for an EONET request; a day window is part of the key. */
export function eonetCacheKey({ status = 'open', days = '20', category = 'all', limit = 250, window = null } = {}) {
    const scope = window
        ? ['range', window.start, window.end]
        : [normalizedPart(status, 'open'), normalizedPart(days, '20')];
    return ['earth:eonet', ...scope, normalizedPart(category), Number(limit) || 250].join(':');
}

export function fetchEarthEonet(url, {
    status = 'open',
    days = '20',
    category = 'all',
    limit = 250,
    window = null,
    signal = null,
    timeout = 15_000,
    forceRefresh = false,
} = {}) {
    const key = eonetCacheKey({ status, days, category, limit, window });
    const policy = windowCachePolicy(window, { ttl: MINUTE, staleTtl: DAY });

    return run('eonet', () => dataBroker.fetchJsonResource(key, url, {
        ttl: policy.ttl,
        staleTtl: policy.staleTtl,
        timeout,
        retries: 2,
        backoffBase: 550,
        signal,
        forceRefresh,
        sourceTimeSelector: latestEonetTimestamp,
        fetchOptions: { mode: 'cors' },
    }));
}

/**
 * requestRuntime key for a USGS request: the live summary feed window
 * ('day' | 'week' | 'month') or the FDSN day window of a historical day.
 */
export function usgsCacheKey({ feed = 'month', window = null, minMagnitude = 2.5 } = {}) {
    return window
        ? `earth:usgs:fdsn:${minMagnitude}:${window.start}:${window.end}`
        : `earth:usgs:${minMagnitude}:${normalizedPart(feed, 'month')}`;
}

export function fetchEarthUsgs(url, {
    feed = 'month',
    window = null,
    minMagnitude = 2.5,
    signal = null,
    forceRefresh = false,
} = {}) {
    const key = usgsCacheKey({ feed, window, minMagnitude });
    const policy = windowCachePolicy(window, { ttl: 2 * MINUTE, staleTtl: DAY });
    return run('usgs', () => dataBroker.fetchJsonResource(key, url, {
        ttl: policy.ttl,
        staleTtl: policy.staleTtl,
        timeout: 12_000,
        retries: 2,
        backoffBase: 500,
        signal,
        forceRefresh,
        sourceTimeSelector: latestUsgsTimestamp,
        fetchOptions: { mode: 'cors' },
    }));
}

export function fetchEarthOvation(url, {
    signal = null,
    forceRefresh = false,
} = {}) {
    return run('ovation', () => dataBroker.fetchJsonResource('earth:noaa:ovation:latest', url, {
        ttl: 5 * MINUTE,
        staleTtl: 6 * HOUR,
        timeout: 14_000,
        retries: 2,
        backoffBase: 650,
        signal,
        forceRefresh,
        sourceTimeSelector: ovationTimestamp,
        fetchOptions: { mode: 'cors' },
    }));
}

export function fetchEarthCelesTrakTle(url, {
    signal = null,
    forceRefresh = false,
} = {}) {
    return run('celestrak', () => dataBroker.fetchTextResource('earth:celestrak:iss:25544', url, {
        ttl: 3 * HOUR,
        staleTtl: 3 * DAY,
        timeout: 10_000,
        retries: 2,
        backoffBase: 650,
        signal,
        forceRefresh,
        sourceTimeSelector: tleEpochTimestamp,
        fetchOptions: { mode: 'cors', cache: 'no-store' },
    }));
}
