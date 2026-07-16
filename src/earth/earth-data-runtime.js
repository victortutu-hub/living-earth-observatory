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

export function fetchEarthEonet(url, {
    status = 'open',
    days = '20',
    category = 'all',
    limit = 250,
    signal = null,
    timeout = 15_000,
    forceRefresh = false,
} = {}) {
    const key = [
        'earth:eonet',
        normalizedPart(status, 'open'),
        normalizedPart(days, '20'),
        normalizedPart(category),
        Number(limit) || 250,
    ].join(':');

    return run('eonet', () => dataBroker.fetchJsonResource(key, url, {
        ttl: MINUTE,
        staleTtl: DAY,
        timeout,
        retries: 2,
        backoffBase: 550,
        signal,
        forceRefresh,
        sourceTimeSelector: latestEonetTimestamp,
        fetchOptions: { mode: 'cors' },
    }));
}

export function fetchEarthUsgs(url, {
    window = 'month',
    signal = null,
    forceRefresh = false,
} = {}) {
    const key = `earth:usgs:2.5:${normalizedPart(window, 'month')}`;
    return run('usgs', () => dataBroker.fetchJsonResource(key, url, {
        ttl: 2 * MINUTE,
        staleTtl: DAY,
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
