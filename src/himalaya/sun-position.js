// Living Himalaya LOT 2: Sun position for the scene light.
// Primary: Astronomy Engine (shared runtime src/earth/astronomy-runtime.js),
// topocentric Horizon() for the focused summit (or the region centre).
// Fallback: an explicitly "approximate" model (declination cosine fit, mean
// solar time, no equation of time, no refraction), declared in the UI.
// Local solar time is LOCAL MEAN SOLAR TIME from the longitude
// (UTC + lon / 15 h), not a civil time zone: the summits lie in Nepal,
// China and Pakistan.
const RAD = Math.PI / 180;

export function utcMinutesOfDay(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
}

/** Local mean solar time in minutes [0, 1440). */
export function localMeanSolarMinutes(date, lonDeg) {
  return (((utcMinutesOfDay(date) + lonDeg * 4) % 1440) + 1440) % 1440;
}

export function formatClock(minutes) {
  const m = Math.floor((((minutes % 1440) + 1440) % 1440) + 1e-6);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Same UTC day as `date`, at `minutes` after 00:00 UTC. */
export function dateAtUtcMinutes(date, minutes) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + Math.round(minutes) * 60000);
}

export function approximateSun(date, latDeg, lonDeg) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = Math.floor((date.getTime() - start) / 86400000);
  const year = date.getUTCFullYear();
  const days = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
  const decl = -23.45 * RAD * Math.cos((2 * Math.PI * (doy + 10)) / days);
  const hourAngle = ((localMeanSolarMinutes(date, lonDeg) / 60) - 12) * 15 * RAD;
  const phi = latDeg * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const azimuth = Math.atan2(-Math.sin(hourAngle) * Math.cos(decl), Math.cos(phi) * Math.sin(decl) - Math.sin(phi) * Math.cos(decl) * Math.cos(hourAngle));
  return { azimuthDeg: ((azimuth / RAD) + 360) % 360, altitudeDeg: altitude / RAD, source: 'approximate' };
}

export function astronomySun(date, latDeg, lonDeg, heightM, Astronomy) {
  const observer = new Astronomy.Observer(latDeg, lonDeg, heightM);
  const equator = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);
  const horizon = Astronomy.Horizon(date, observer, equator.ra, equator.dec, 'normal');
  return { azimuthDeg: horizon.azimuth, altitudeDeg: horizon.altitude, source: 'astronomy-engine' };
}

/** Astronomy Engine when available, otherwise the declared approximation. */
export function computeSun({ date, lat, lon, heightM = 0, Astronomy = null }) {
  if (Astronomy) {
    try { return astronomySun(date, lat, lon, heightM, Astronomy); } catch (_) { /* fall through */ }
  }
  return approximateSun(date, lat, lon);
}

/**
 * Unit vector towards the Sun in scene coordinates (y up), using the local
 * east/north basis of the projection (see projection.js localBasis).
 */
export function sunDirectionScene(azimuthDeg, altitudeDeg, basis) {
  const az = azimuthDeg * RAD;
  const alt = altitudeDeg * RAD;
  const e = Math.sin(az) * Math.cos(alt);
  const n = Math.cos(az) * Math.cos(alt);
  return {
    x: basis.east.x * e + basis.north.x * n,
    y: Math.sin(alt),
    z: basis.east.z * e + basis.north.z * n,
  };
}
