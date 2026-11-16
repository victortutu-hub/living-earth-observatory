// Living Himalaya LOT 3: summit weather from Open-Meteo pressure levels
// (model gfs_global = NOAA GFS 0.25°), interpolated to the OFFICIAL summit
// elevation. Pure functions; the fetch/cache/abort wiring lives in
// weather-client.js.
//   * Bracketing by the hour's geopotential_height (not a standard atmosphere).
//   * Pressure linear in ln(p); temperature, relative humidity and cloud cover
//     linear in height; wind interpolated on u/v and converted back.
//   * Exactly on a level -> the level's values; outside the levels -> no
//     values, flagged "outside model levels … not extrapolated".
//   * The hour is the nearest model hour to the slider time (no temporal
//     interpolation). Everything is "Model prediction"; pressure-level values
//     describe the free atmosphere at that height, not summit surface
//     conditions.
import { formatClock, localMeanSolarMinutes } from './sun-position.js';

export const WEATHER_MODEL = Object.freeze({ id: 'gfs_global', metaId: 'ncep_gfs025', label: 'GFS 0.25°', authority: 'NOAA NCEP GFS' });
export const PRESSURE_LEVELS_HPA = Object.freeze([200, 250, 300, 350, 400, 500]);
export const WEATHER_VARIABLES = Object.freeze(['temperature', 'relative_humidity', 'cloud_cover', 'wind_speed', 'wind_direction', 'geopotential_height']);
export const WEATHER_CACHE_TTL_MS = 30 * 60_000;
export const EXACT_LEVEL_TOLERANCE_M = 0.5;
export const FREE_ATMOSPHERE_NOTE = 'Pressure-level values describe the free atmosphere at that height, not summit surface conditions';
const RAD = Math.PI / 180;

/** Weather is today's model run only: true when `date` is on today's UTC day. */
export function isWeatherDay(date, now = new Date()) {
  return date.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
}

export function forecastUrl(peak) {
  const hourly = PRESSURE_LEVELS_HPA.flatMap((p) => WEATHER_VARIABLES.map((v) => `${v}_${p}hPa`)).join(',');
  const params = new URLSearchParams({
    latitude: peak.lat.toFixed(5), longitude: peak.lon.toFixed(5), hourly,
    models: WEATHER_MODEL.id, forecast_days: '1', timezone: 'GMT',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString().replace(/%2C/g, ',')}`;
}

export function modelMetaUrl() {
  return `https://api.open-meteo.com/data/${WEATHER_MODEL.metaId}/static/meta.json`;
}

/** Hourly series value, accepting both plain and model-suffixed keys. */
function series(hourly, variable, level) {
  const key = `${variable}_${level}hPa`;
  return hourly[key] || hourly[`${key}_${WEATHER_MODEL.id}`] || null;
}

/** Open-Meteo GMT times ("2026-11-15T06:00") -> epoch ms (UTC). */
export function parseGmtTime(text) {
  return Date.parse(`${text}${text.length === 16 ? ':00' : ''}Z`);
}

/** Index of the model hour nearest to `date`, or -1 when the day series does not cover it (> 1 h away). */
export function nearestHourIndex(times, date) {
  let best = -1; let bestDiff = Infinity;
  const target = date.getTime();
  times.forEach((text, i) => {
    const diff = Math.abs(parseGmtTime(text) - target);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return bestDiff <= 60 * 60_000 ? best : -1;
}

/** Levels of one hour, sorted by geopotential height (ascending). */
export function levelsAtHour(forecast, index) {
  const hourly = forecast.hourly || {};
  return PRESSURE_LEVELS_HPA.map((p) => ({
    pressureHpa: p,
    heightM: series(hourly, 'geopotential_height', p)?.[index] ?? null,
    temperatureC: series(hourly, 'temperature', p)?.[index] ?? null,
    relativeHumidityPct: series(hourly, 'relative_humidity', p)?.[index] ?? null,
    cloudCoverPct: series(hourly, 'cloud_cover', p)?.[index] ?? null,
    windSpeedKmh: series(hourly, 'wind_speed', p)?.[index] ?? null,
    windDirectionDeg: series(hourly, 'wind_direction', p)?.[index] ?? null,
  })).filter((level) => Number.isFinite(level.heightM)).sort((a, b) => a.heightM - b.heightM);
}

export function windToUv(speed, directionDeg) {
  return { u: -speed * Math.sin(directionDeg * RAD), v: -speed * Math.cos(directionDeg * RAD) };
}
export function uvToWind(u, v) {
  const speed = Math.hypot(u, v);
  const direction = speed < 1e-9 ? 0 : ((Math.atan2(-u, -v) / RAD) + 360) % 360;
  return { speed, direction };
}

const lerp = (a, b, f) => (Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * f : null);

function pickLevel(level) {
  return {
    status: 'exact', lowerHpa: level.pressureHpa, upperHpa: level.pressureHpa,
    pressureHpa: level.pressureHpa, temperatureC: level.temperatureC, relativeHumidityPct: level.relativeHumidityPct,
    cloudCoverPct: level.cloudCoverPct, windSpeedKmh: level.windSpeedKmh, windDirectionDeg: level.windDirectionDeg,
  };
}

/** Values at `heightM` from the hour's levels (see header for the rules). */
export function interpolateAtHeight(levels, heightM) {
  if (!levels.length) return { status: 'no-levels' };
  const exact = levels.find((level) => Math.abs(level.heightM - heightM) <= EXACT_LEVEL_TOLERANCE_M);
  if (exact) return pickLevel(exact);
  const lowest = levels[0]; const highest = levels[levels.length - 1];
  if (heightM < lowest.heightM || heightM > highest.heightM) {
    return { status: 'outside', lowestHeightM: lowest.heightM, highestHeightM: highest.heightM, lowestHpa: lowest.pressureHpa, highestHpa: highest.pressureHpa };
  }
  let i = 0;
  while (i < levels.length - 1 && !(levels[i].heightM <= heightM && heightM <= levels[i + 1].heightM)) i++;
  const lo = levels[i]; const hi = levels[i + 1];
  const f = (heightM - lo.heightM) / (hi.heightM - lo.heightM);
  const lnP = Math.log(lo.pressureHpa) + f * (Math.log(hi.pressureHpa) - Math.log(lo.pressureHpa));
  let wind = { speed: null, direction: null };
  if ([lo.windSpeedKmh, lo.windDirectionDeg, hi.windSpeedKmh, hi.windDirectionDeg].every(Number.isFinite)) {
    const a = windToUv(lo.windSpeedKmh, lo.windDirectionDeg); const b = windToUv(hi.windSpeedKmh, hi.windDirectionDeg);
    wind = uvToWind(lerp(a.u, b.u, f), lerp(a.v, b.v, f));
  }
  return {
    status: 'interpolated', lowerHpa: lo.pressureHpa, upperHpa: hi.pressureHpa, fraction: f,
    pressureHpa: Math.exp(lnP),
    temperatureC: lerp(lo.temperatureC, hi.temperatureC, f),
    relativeHumidityPct: lerp(lo.relativeHumidityPct, hi.relativeHumidityPct, f),
    cloudCoverPct: lerp(lo.cloudCoverPct, hi.cloudCoverPct, f),
    windSpeedKmh: wind.speed, windDirectionDeg: wind.direction,
  };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(directionDeg) {
  return COMPASS[Math.round((((directionDeg % 360) + 360) % 360) / 22.5) % 16];
}

export function formatRunTime(epochSeconds) {
  const iso = new Date(epochSeconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00 UTC`;
}

/** "Model prediction · Open-Meteo (GFS 0.25°), run … (latest at fetch time), +N h" or the past-hour label. */
export function predictionLabel(validMs, meta) {
  const base = `Model prediction · Open-Meteo (${WEATHER_MODEL.label})`;
  const runSeconds = meta?.last_run_initialisation_time;
  if (!Number.isFinite(runSeconds)) return `${base}, run unknown`;
  const run = `run ${formatRunTime(runSeconds)} (latest at fetch time)`;
  const leadHours = Math.round((validMs - runSeconds * 1000) / 3_600_000);
  if (validMs < runSeconds * 1000) return `Model prediction for a past hour (not an observation) · Open-Meteo (${WEATHER_MODEL.label}), ${run}`;
  return `${base}, ${run}, +${leadHours} h`;
}

export function formatAge(ageMs) {
  const minutes = Math.round(ageMs / 60_000);
  return minutes < 1 ? 'less than a minute old' : `${minutes} min old`;
}

const n0 = (v) => Math.round(v).toLocaleString('en-US');
const n1 = (v) => (Math.round(v * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Rows for the "Summit weather" section. `state` = { status, forecast, meta,
 * fromCache, cacheAgeMs } (see weather-client.js); `date` = slider time.
 */
export function summitWeatherRows({ peak, state, date }) {
  if (state?.status === 'other-day') return [['Summit weather', 'Summit weather: only available for today', 'pending']];
  if (!state || state.status === 'loading') return [['Summit weather', 'loading…', 'pending']];
  if (state.status === 'unavailable') {
    return [['Summit weather', 'Summit weather: temporarily unavailable', 'pending']];
  }
  const { forecast, meta } = state;
  const index = nearestHourIndex(forecast.hourly?.time || [], date);
  if (index < 0) return [['Summit weather', 'No model hour for the selected time (today\'s series only)', 'pending']];
  const validMs = parseGmtTime(forecast.hourly.time[index]);
  const result = interpolateAtHeight(levelsAtHour(forecast, index), peak.elevationM);
  const rows = [];
  const notProvided = 'not provided by the model';
  if (result.status === 'outside') {
    rows.push(['Summit weather', `outside model levels (available ${n0(result.lowestHeightM)}–${n0(result.highestHeightM)} m) — not extrapolated`, 'pending']);
  } else if (result.status === 'no-levels') {
    rows.push(['Summit weather', 'no pressure levels in the response', 'pending']);
  } else {
    rows.push(['Temperature', Number.isFinite(result.temperatureC) ? `${n1(result.temperatureC)} °C` : notProvided]);
    rows.push(['Wind', Number.isFinite(result.windSpeedKmh) ? `${n0(result.windSpeedKmh)} km/h from ${n0(result.windDirectionDeg)}° (${compass(result.windDirectionDeg)})` : notProvided]);
    rows.push(['Relative humidity', Number.isFinite(result.relativeHumidityPct) ? `${n0(result.relativeHumidityPct)}%` : notProvided]);
    rows.push(['Cloud cover', Number.isFinite(result.cloudCoverPct) ? `${n0(result.cloudCoverPct)}% at this level` : notProvided]);
    rows.push(['Pressure', `${n0(result.pressureHpa)} hPa${result.status === 'interpolated' ? ' (interpolated)' : ''}`]);
    rows.push(['Height', result.status === 'exact'
      ? `on the ${result.lowerHpa} hPa level (${n0(peak.elevationM)} m)`
      : `interpolated to ${peak.elevationM.toLocaleString('en-US')} m between ${result.lowerHpa} and ${result.upperHpa} hPa`]);
  }
  const iso = new Date(validMs).toISOString();
  rows.push(['Valid', `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC · local mean solar time ${formatClock(localMeanSolarMinutes(new Date(validMs), peak.lon))}`]);
  rows.push(['Label', predictionLabel(validMs, meta)]);
  if (Number.isFinite(forecast.elevation)) rows.push(['Grid elevation', `Open-Meteo grid elevation (90 m DEM used for downscaling): ${n0(forecast.elevation)} m — not the model terrain`]);
  rows.push(['Note', FREE_ATMOSPHERE_NOTE]);
  if (state.fromCache) rows.push(['Cache', `served from the session cache, ${formatAge(state.cacheAgeMs || 0)}${state.stale ? ' (network unavailable)' : ''}`]);
  return rows;
}

/** Provenance-bar segment. */
export function weatherBarSegment(state, date) {
  const head = `Weather: Open-Meteo ${WEATHER_MODEL.label} (Model prediction)`;
  if (!state) return `${head}, select a summit`;
  if (state.status === 'loading') return `${head}, loading`;
  if (state.status === 'other-day') return `${head}, only available for today`;
  if (state.status === 'unavailable') return `${head}, temporarily unavailable`;
  const index = nearestHourIndex(state.forecast.hourly?.time || [], date);
  if (index < 0) return `${head}, no hour for the selected time`;
  const iso = new Date(parseGmtTime(state.forecast.hourly.time[index])).toISOString();
  return `${head}, ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
