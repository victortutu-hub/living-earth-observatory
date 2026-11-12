import { describe, expect, it } from 'vitest';
import {
  composeSourceStatus,
  fetchStateFromProxyStatus,
  fetchStateFromRuntime,
  formatRelativeAge,
  parseOpenMeteoTime,
} from '../src/earth/temporal-provenance.js';
import { describeGdacsStatus, gdacsDataTime } from '../src/earth/gdacs-provider.refactored.js';

const NOW = Date.parse('2026-11-11T15:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('relative age formatting', () => {
  it.each([
    [0, 'just now'],
    [59_000, 'just now'],
    [7 * MIN, '7 min ago'],
    [59 * MIN, '59 min ago'],
    [3 * HOUR, '3 h ago'],
    [47 * HOUR, '47 h ago'],
    [3 * 24 * HOUR, '3 d ago'],
    [-35 * MIN, 'in 35 min'],
  ])('%i ms -> %s', (ageMs, expected) => {
    expect(formatRelativeAge(ageMs)).toBe(expected);
  });

  it('returns null for an unknown age', () => {
    expect(formatRelativeAge(NaN)).toBeNull();
  });
});

describe('data time vs fetched, per proxy state', () => {
  const base = { sourceKey: 'firms', message: 'NASA FIRMS: top 2 of 5 hotspots by FRP', dataTime: new Date(NOW - 2 * HOUR).toISOString(), now: NOW };

  it('live: data age and fetch age, absolute UTC in the tooltip', () => {
    const status = composeSourceStatus({ ...base, fetchedAt: new Date(NOW - 2 * MIN).toISOString(), fetchState: fetchStateFromProxyStatus('live') });
    expect(status.message).toBe('Observed · NASA FIRMS: top 2 of 5 hotspots by FRP · data 2 h ago · fetched 2 min ago');
    expect(status.title).toContain('Data time: 11 Nov 2026 13:00 UTC');
    expect(status.title).toContain('Fetched: 11 Nov 2026 14:58 UTC (live response)');
  });

  it('cache-fresh: "proxy cache, fetched N min ago"', () => {
    const status = composeSourceStatus({ ...base, fetchedAt: new Date(NOW - 7 * MIN).toISOString(), fetchState: fetchStateFromProxyStatus('cache-fresh') });
    expect(status.message).toContain('proxy cache, fetched 7 min ago');
    expect(status.title).toContain('(proxy cache)');
  });

  it('stale-cache: "stale — live fetch failed, fetched N h ago"', () => {
    const status = composeSourceStatus({ ...base, fetchedAt: new Date(NOW - 3 * HOUR).toISOString(), fetchState: fetchStateFromProxyStatus('stale-cache') });
    expect(status.message).toContain('stale — live fetch failed, fetched 3 h ago');
    expect(status.title).toContain('(stale cache — live fetch failed)');
  });

  it('says so when the source gives no data time instead of using the fetch time', () => {
    const status = composeSourceStatus({ sourceKey: 'gvp', message: 'GVP volcanoes: 3', fetchedAt: new Date(NOW - MIN * 5).toISOString(), fetchState: 'proxy-cache', now: NOW });
    expect(status.message).toBe('Observed · GVP volcanoes: 3 · proxy cache, fetched 5 min ago');
    expect(status.title).toContain('Data time: unavailable from source');
  });

  it('recomputes the age from timestamps on every render', () => {
    const input = { ...base, fetchedAt: new Date(NOW - 7 * MIN).toISOString(), fetchState: 'proxy-cache' };
    expect(composeSourceStatus(input).message).not.toBe(composeSourceStatus({ ...input, now: NOW + 30 * MIN }).message);
    expect(composeSourceStatus({ ...input, now: NOW + 30 * MIN }).message).toContain('fetched 37 min ago');
  });

  it('maps requestRuntime results to fetch states', () => {
    expect(fetchStateFromRuntime({ state: 'stale', meta: { cache: 'stale-if-error' } })).toBe('stale');
    expect(fetchStateFromRuntime({ state: 'live', meta: { cache: 'hit' } })).toBe('cache');
    expect(fetchStateFromRuntime({ state: 'live', meta: { cache: 'miss' } })).toBe('live');
  });
});

describe('Open-Meteo model valid time', () => {
  it('reads current.time as UTC with the declared offset', () => {
    expect(parseOpenMeteoTime('2026-11-11T14:00', 0)).toBe('2026-11-11T14:00:00.000Z');
    expect(parseOpenMeteoTime('2026-11-11T16:00', 7200)).toBe('2026-11-11T14:00:00.000Z');
    expect(parseOpenMeteoTime('2026-11-11T14:00Z', 7200)).toBe('2026-11-11T14:00:00.000Z');
    expect(parseOpenMeteoTime('', 0)).toBeNull();
  });

  it('puts the valid time in the prediction tooltip', () => {
    const status = composeSourceStatus({ sourceKey: 'openMeteo', message: 'Wind: on', dataTime: '2026-11-11T14:00:00Z', validAt: '2026-11-11T14:00:00Z', now: NOW });
    expect(status.message.startsWith('Model prediction · Wind: on · data 1 h ago')).toBe(true);
    expect(status.title).toContain('Open-Meteo model forecast, valid at 2026-11-11 14:00 UTC');
  });
});

describe('GDACS data time', () => {
  const features = [
    { properties: { fromdate: '2026-11-09T10:00:00Z' } },
    { properties: { fromdate: '2026-11-10T22:30:00Z' } },
    { properties: { fromdate: 'not a date' } },
  ];

  it('prefers lastBuildDate / pubDate declared by the feed', () => {
    expect(gdacsDataTime({ data: { lastBuildDate: 'Tue, 11 Nov 2026 12:00:00 GMT', features } })).toBe('2026-11-11T12:00:00.000Z');
    expect(gdacsDataTime({ data: { pubDate: '2026-11-11T11:00:00Z', features } })).toBe('2026-11-11T11:00:00.000Z');
  });

  it('falls back to the newest event date, never the browser clock', () => {
    expect(gdacsDataTime({ data: { features } })).toBe('2026-11-10T22:30:00.000Z');
    expect(gdacsDataTime({ data: { features: [] } })).toBeNull();
  });

  it('labels GDACS as interpretive and shows the proxy state', () => {
    const status = describeGdacsStatus({ count: 12, dataTime: '2026-11-10T22:30:00Z', fetchedAt: new Date(NOW - 4 * MIN).toISOString(), proxyStatus: 'cache-fresh', runtimeState: 'live', now: NOW });
    expect(status.message).toBe('Interpretive · GDACS: 12 alerts · data 16 h ago · proxy cache, fetched 4 min ago');
    expect(status.title).toContain('Event reported; alert level estimated by the GDACS impact model');
  });
});
