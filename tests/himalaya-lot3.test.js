// Himalaya LOT 3 — summit weather (Open-Meteo GFS pressure levels): URL,
// interpolation, wind on u/v, nearest hour, run labels, session cache,
// abort on summit change, 429/offline; night message and moonlight. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHimalayaPeak } from '../src/config/himalaya-peaks.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import { platformRegistry } from '../src/core/platform-registry.js';
import { createRequestRuntime } from '../src/core/runtime/request-runtime.js';
import {
  FREE_ATMOSPHERE_NOTE, PRESSURE_LEVELS_HPA, WEATHER_MODEL, forecastUrl, interpolateAtHeight, levelsAtHour, modelMetaUrl,
  nearestHourIndex, predictionLabel, summitWeatherRows, uvToWind, weatherBarSegment, windToUv,
} from '../src/himalaya/summit-weather.js';
import { createSessionStorageCache, createWeatherClient } from '../src/himalaya/weather-client.js';
import { MOONLIGHT_LABEL, astronomyMoon, computeMoon, moonlightIntensity, nightMessage } from '../src/himalaya/moon-position.js';
import { ATTRIBUTIONS, composeProvenanceBar } from '../src/himalaya/himalaya-provenance.js';
import { FUTURE_FIELDS } from '../src/himalaya/himalaya-app.js';

const everest = getHimalayaPeak('everest');
const k2 = getHimalayaPeak('k2');

// Synthetic fixture in the Open-Meteo format, built from tmp/himalaya/lot3-etapa0.json
// (Everest 2026-11-15T06:00; the 350 hPa row from the gfs_global response; RH/wind at
// 350 hPa synthetic). The same profile is used for every hour, except the wind at 300 hPa,
// which grows by 1 km/h per hour so that the slider visibly changes the value.
const PROFILE = {
  200: { gh: 12293.02, t: -52, rh: 15, cc: 0, ws: 223.7, wd: 261 },
  250: { gh: 10815.24, t: -41.5, rh: 13, cc: 0, ws: 205.6, wd: 266 },
  300: { gh: 9554.84, t: -32.5, rh: 20, cc: 0, ws: 198, wd: 264 },
  350: { gh: 8437.76, t: -26.1, rh: 22, cc: 0, ws: 175, wd: 265 },
  400: { gh: 7476.54, t: -21, rh: 25, cc: 0, ws: 149.4, wd: 265 },
  500: { gh: 5789, t: -8.4, rh: 56, cc: 0, ws: 50.6, wd: 256 },
};
function fixture({ suffix = '' } = {}) {
  const time = Array.from({ length: 24 }, (_, h) => `2026-11-15T${String(h).padStart(2, '0')}:00`);
  const hourly = { time };
  for (const p of PRESSURE_LEVELS_HPA) {
    const v = PROFILE[p];
    hourly[`geopotential_height_${p}hPa${suffix}`] = time.map(() => v.gh);
    hourly[`temperature_${p}hPa${suffix}`] = time.map(() => v.t);
    hourly[`relative_humidity_${p}hPa${suffix}`] = time.map(() => v.rh);
    hourly[`cloud_cover_${p}hPa${suffix}`] = time.map(() => v.cc);
    hourly[`wind_speed_${p}hPa${suffix}`] = time.map((_, h) => (p === 300 ? v.ws + h : v.ws));
    hourly[`wind_direction_${p}hPa${suffix}`] = time.map(() => v.wd);
  }
  return { latitude: 28, longitude: 87, elevation: 8724, timezone: 'GMT', hourly };
}
const META = { last_run_initialisation_time: 1794722400, last_run_availability_time: 1794747776, update_interval_seconds: 21600 }; // run 2026-11-15 06:00 UTC

describe('request', () => {
  it('asks gfs_global for 6 levels x 6 variables of today (GMT), and the ncep_gfs025 metadata', () => {
    const url = new URL(forecastUrl(everest));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('models')).toBe('gfs_global');
    expect(url.searchParams.get('forecast_days')).toBe('1');
    expect(url.searchParams.get('timezone')).toBe('GMT');
    expect(url.searchParams.get('hourly').split(',')).toHaveLength(36);
    expect(url.searchParams.get('hourly')).toContain('geopotential_height_350hPa');
    expect(modelMetaUrl()).toBe('https://api.open-meteo.com/data/ncep_gfs025/static/meta.json');
    expect(WEATHER_MODEL.label).toBe('GFS 0.25°');
  });
});

describe('interpolation to the official summit elevation', () => {
  const levels = levelsAtHour(fixture(), 6);

  it('brackets by geopotential height: ln p for pressure, linear in height for T/RH/cloud', () => {
    const r = interpolateAtHeight(levels, everest.elevationM);
    expect(r.status).toBe('interpolated');
    expect([r.lowerHpa, r.upperHpa]).toEqual([350, 300]);
    const f = (8848.86 - 8437.76) / (9554.84 - 8437.76);
    expect(r.temperatureC).toBeCloseTo(-26.1 + f * (-32.5 + 26.1), 9);
    expect(r.pressureHpa).toBeCloseTo(Math.exp(Math.log(350) + f * (Math.log(300) - Math.log(350))), 9);
    expect(r.pressureHpa).toBeCloseTo(330.7, 1);
    expect(r.relativeHumidityPct).toBeCloseTo(22 + f * (20 - 22), 9);
  });

  it('takes the level values when the height is exactly on a level', () => {
    const r = interpolateAtHeight(levels, 9554.84);
    expect(r.status).toBe('exact');
    expect(r.pressureHpa).toBe(300);
    expect(r.temperatureC).toBe(-32.5);
    expect(r.windSpeedKmh).toBe(198 + 6);
  });

  it('flags heights outside the model levels and never extrapolates', () => {
    for (const h of [5000, 13000]) {
      const r = interpolateAtHeight(levels, h);
      expect(r.status).toBe('outside');
      expect(r.temperatureC).toBeUndefined();
    }
    const rows = summitWeatherRows({ peak: { ...everest, elevationM: 5000 }, state: { status: 'ready', forecast: fixture(), meta: META }, date: new Date('2026-11-15T06:00:00Z') });
    expect(rows[0][1]).toMatch(/^outside model levels \(available 5,789–12,293 m\) — not extrapolated$/);
    expect(rows.some(([k]) => k === 'Temperature')).toBe(false);
  });

  it('interpolates wind on u/v across 0°/360° (never through 180°)', () => {
    const levels2 = [
      { pressureHpa: 400, heightM: 7000, windSpeedKmh: 100, windDirectionDeg: 350 },
      { pressureHpa: 300, heightM: 9000, windSpeedKmh: 100, windDirectionDeg: 10 },
    ];
    const r = interpolateAtHeight(levels2, 8000);
    expect(Math.min(r.windDirectionDeg, 360 - r.windDirectionDeg)).toBeLessThan(0.01);
    expect(r.windSpeedKmh).toBeCloseTo(100 * Math.cos((10 * Math.PI) / 180), 6);
    const back = uvToWind(windToUv(50, 270).u, windToUv(50, 270).v);
    expect(back.speed).toBeCloseTo(50, 9);
    expect(back.direction).toBeCloseTo(270, 9);
  });

  it('accepts model-suffixed keys as well', () => {
    expect(levelsAtHour(fixture({ suffix: '_gfs_global' }), 6)).toHaveLength(6);
  });
});

describe('time slider -> nearest model hour', () => {
  const times = fixture().hourly.time;
  it('picks the nearest hour, no temporal interpolation, and nothing outside today', () => {
    expect(nearestHourIndex(times, new Date('2026-11-15T06:29:00Z'))).toBe(6);
    expect(nearestHourIndex(times, new Date('2026-11-15T06:31:00Z'))).toBe(7);
    expect(nearestHourIndex(times, new Date('2026-11-16T01:30:00Z'))).toBe(-1);
    const at = (iso) => summitWeatherRows({ peak: everest, state: { status: 'ready', forecast: fixture(), meta: META }, date: new Date(iso) });
    const wind06 = Object.fromEntries(at('2026-11-15T06:10:00Z')).Wind;
    const wind12 = Object.fromEntries(at('2026-11-15T12:10:00Z')).Wind;
    expect(wind06).not.toBe(wind12); // the slider changes the value
    expect(Object.fromEntries(at('2026-11-15T06:10:00Z')).Valid).toBe('2026-11-15 06:00 UTC · local mean solar time 11:47'); // 06:00 + 86.925° x 4 min = 11:47.7, shown truncated
  });
});

describe('labels', () => {
  it('distinguishes hours before the run from forecast hours (+N h)', () => {
    expect(predictionLabel(Date.parse('2026-11-15T03:00:00Z'), META)).toBe('Model prediction for a past hour (not an observation) · Open-Meteo (GFS 0.25°), run 2026-11-15 06:00 UTC (latest at fetch time)');
    expect(predictionLabel(Date.parse('2026-11-15T12:00:00Z'), META)).toBe('Model prediction · Open-Meteo (GFS 0.25°), run 2026-11-15 06:00 UTC (latest at fetch time), +6 h');
    expect(predictionLabel(Date.parse('2026-11-15T12:00:00Z'), null)).toContain('run unknown');
  });

  it('shows interpolation, grid elevation (not the model terrain) and the free-atmosphere note; no derived values', () => {
    const rows = Object.fromEntries(summitWeatherRows({ peak: everest, state: { status: 'ready', forecast: fixture(), meta: META }, date: new Date('2026-11-15T08:00:00Z') }));
    expect(rows.Height).toBe('interpolated to 8,848.86 m between 350 and 300 hPa');
    expect(rows['Grid elevation']).toBe('Open-Meteo grid elevation (90 m DEM used for downscaling): 8,724 m — not the model terrain');
    expect(rows.Note).toBe(FREE_ATMOSPHERE_NOTE);
    expect(rows.Temperature).toBe('-28.5 °C');
    expect(rows.Pressure).toBe('331 hPa (interpolated)');
    expect(rows['Cloud cover']).toBe('0% at this level');
    expect(Object.keys(rows).some((k) => /chill|feels/i.test(k))).toBe(false);
    expect(rows.Label).toContain('+2 h');
  });

  it('adds the weather segment to the provenance bar and the Open-Meteo attribution', () => {
    const state = { status: 'ready', forecast: fixture(), meta: META };
    const seg = weatherBarSegment(state, new Date('2026-11-15T08:20:00Z'));
    expect(seg).toBe('Weather: Open-Meteo GFS 0.25° (Model prediction), 2026-11-15 08:00 UTC');
    expect(composeProvenanceBar({ sun: { source: 'astronomy-engine' }, date: new Date('2026-11-15T08:20:00Z'), weather: seg }).endsWith(` | ${seg}`)).toBe(true);
    expect(weatherBarSegment({ status: 'unavailable' }, new Date())).toContain('temporarily unavailable');
    const om = ATTRIBUTIONS.find((a) => a.id === 'openMeteo');
    expect(om.text).toContain('Weather data by Open-Meteo.com (CC BY 4.0)');
    expect(om.text).toContain('NOAA NCEP GFS');
    expect(FUTURE_FIELDS).toEqual(['History']);
  });

  it('registers a prediction source for Living Himalaya', () => {
    expect(SOURCE_DEFINITIONS.openMeteoPressureLevels.provenance).toBe('prediction');
    expect(platformRegistry.getObservatory('living-himalaya').sources).toContain('openMeteoPressureLevels');
  });
});

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('weather client: cache, abort, failures', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('serves a summit from the session cache for 30 min (2 requests per summit), then refetches', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T08:00:00Z'));
    const fetchMock = vi.fn(async (url) => jsonResponse(String(url).includes('meta.json') ? META : fixture()));
    vi.stubGlobal('fetch', fetchMock);
    const storage = memoryStorage();
    const runtime = createRequestRuntime({ cache: createSessionStorageCache({ storage }) });
    const states = [];
    const client = createWeatherClient({ onChange: (s) => states.push(s), runtime });
    await client.load(everest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ peakId: 'everest', status: 'ready', fromCache: false });
    vi.setSystemTime(new Date('2026-11-15T08:29:00Z'));
    await client.load(everest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ status: 'ready', fromCache: true });
    expect(states.at(-1).cacheAgeMs).toBe(29 * 60_000);
    const rows = Object.fromEntries(summitWeatherRows({ peak: everest, state: states.at(-1), date: new Date('2026-11-15T08:29:00Z') }));
    expect(rows.Cache).toBe('served from the session cache, 29 min old');
    vi.setSystemTime(new Date('2026-11-15T08:31:00Z'));
    await client.load(everest);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect([...storage.map.keys()].sort()).toEqual(['lumi-himalaya:himalaya-weather-meta:everest', 'lumi-himalaya:himalaya-weather:everest']);
  });

  it('aborts the previous summit and ignores its late response', async () => {
    const pending = [];
    vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      pending.push({ url: String(url), resolve: () => resolve(jsonResponse(String(url).includes('meta.json') ? META : fixture())) });
    })));
    const states = [];
    const runtime = createRequestRuntime({ cache: createSessionStorageCache({ storage: memoryStorage() }) });
    const client = createWeatherClient({ onChange: (s) => states.push({ ...s }), runtime });
    const first = client.load(everest);
    const second = client.load(k2);
    await vi.waitFor(() => {
      expect(pending.some((p) => p.url.includes('latitude=35.88'))).toBe(true);
      expect(pending.filter((p) => p.url.includes('meta.json')).length).toBeGreaterThanOrEqual(1);
    });
    await new Promise((r) => setTimeout(r, 20));
    pending.forEach((p) => p.resolve());
    await Promise.all([first, second]);
    expect(states.map((s) => `${s.peakId}:${s.status}`)).toEqual(['everest:loading', 'k2:loading', 'k2:ready']);
  });

  it('reports 429 / offline as "temporarily unavailable" and labels cached data with its age', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Too many requests', { status: 429, headers: { 'retry-after': '0' } })));
    const states = [];
    const client = createWeatherClient({ onChange: (s) => states.push(s), runtime: createRequestRuntime({ cache: createSessionStorageCache({ storage: memoryStorage() }) }) });
    await client.load(everest);
    expect(states.at(-1).status).toBe('unavailable');
    expect(summitWeatherRows({ peak: everest, state: states.at(-1), date: new Date() })[0][1]).toBe('Summit weather: temporarily unavailable');

    // Offline with a 2 h old cache entry: served, flagged stale, with its age.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    const storage = memoryStorage();
    const old = Date.parse('2026-11-15T08:00:00Z');
    storage.setItem('lumi-himalaya:himalaya-weather:everest', JSON.stringify({ key: 'himalaya-weather:everest', value: fixture(), storedAt: old }));
    storage.setItem('lumi-himalaya:himalaya-weather-meta:everest', JSON.stringify({ key: 'himalaya-weather-meta:everest', value: META, storedAt: old }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const offline = [];
    const c2 = createWeatherClient({ onChange: (s) => offline.push(s), runtime: createRequestRuntime({ cache: createSessionStorageCache({ storage }) }) });
    await c2.load(everest);
    expect(offline.at(-1)).toMatchObject({ status: 'ready', fromCache: true, stale: true, cacheAgeMs: 2 * 3_600_000 });
    const rows = Object.fromEntries(summitWeatherRows({ peak: everest, state: offline.at(-1), date: new Date('2026-11-15T10:00:00Z') }));
    expect(rows.Cache).toBe('served from the session cache, 120 min old (network unavailable)');
  });
});

describe('night message and moonlight', () => {
  const sunDown = { altitudeDeg: -38.4, azimuthDeg: 270 };
  it('shows the night message only when the Sun is below the horizon, with the Moon when it is up', () => {
    expect(nightMessage({ peakName: 'Mount Everest', sun: { altitudeDeg: 12 }, moon: null, isNow: true })).toBeNull();
    const withoutMoon = nightMessage({ peakName: 'Mount Everest', sun: sunDown, moon: { altitudeDeg: -5, phaseFraction: 0.4 }, isNow: true });
    expect(withoutMoon).toEqual({ text: 'Night at Mount Everest now (Sun −38°) — move the time slider to see daylight', moon: null });
    const withMoon = nightMessage({ peakName: 'K2', sun: sunDown, moon: { altitudeDeg: 31.6, phaseFraction: 0.27 }, isNow: false });
    expect(withMoon.text).toBe('Night at K2 at the selected time (Sun −38°) — move the time slider to see daylight');
    expect(withMoon.moon).toBe(`${MOONLIGHT_LABEL} · Moon 27% illuminated, altitude +32°`);
    expect(MOONLIGHT_LABEL).toBe('Moonlight (physical-model, approximate; brightness exaggerated for visibility)');
  });

  it('computes the Moon with Astronomy Engine only and scales a non-photometric intensity', () => {
    expect(computeMoon({ date: new Date(), lat: 28, lon: 87 })).toBeNull();
    const Astronomy = {
      Body: { Moon: 'Moon' },
      Observer: function Observer(lat, lon, h) { Object.assign(this, { lat, lon, h }); },
      Equator: vi.fn(() => ({ ra: 2, dec: 10 })),
      Horizon: vi.fn(() => ({ azimuth: 120, altitude: 40 })),
      Illumination: vi.fn(() => ({ phase_fraction: 0.5 })),
    };
    const moon = astronomyMoon(new Date('2026-11-15T18:00:00Z'), 28, 87, 8848, Astronomy);
    expect(moon).toEqual({ azimuthDeg: 120, altitudeDeg: 40, phaseFraction: 0.5, source: 'astronomy-engine' });
    expect(Astronomy.Illumination).toHaveBeenCalledWith('Moon', expect.any(Date));
    expect(moonlightIntensity({ altitudeDeg: -1, phaseFraction: 1 })).toBe(0);
    expect(moonlightIntensity({ altitudeDeg: 60, phaseFraction: 1 })).toBeGreaterThan(moonlightIntensity({ altitudeDeg: 60, phaseFraction: 0.2 }));
    expect(computeMoon({ date: new Date(), lat: 28, lon: 87, Astronomy: { ...Astronomy, Equator: () => { throw new Error('x'); } } })).toBeNull();
  });
});
