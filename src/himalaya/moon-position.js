// Living Himalaya LOT 3: the real Moon for the night scene. Astronomy Engine
// only (no approximate fallback: without the ephemeris there is no
// moonlight). The scene light is NOT photometric: full moonlight is ~0.25 lx
// against ~100 000 lx of sunlight, so its brightness is exaggerated for
// visibility and labelled as such.
export const MOONLIGHT_LABEL = 'Moonlight (physical-model, approximate; brightness exaggerated for visibility)';
export const MOONLIGHT_GAIN = 0.9;

export function astronomyMoon(date, latDeg, lonDeg, heightM, Astronomy) {
  const observer = new Astronomy.Observer(latDeg, lonDeg, heightM);
  const equator = Astronomy.Equator(Astronomy.Body.Moon, date, observer, true, true);
  const horizon = Astronomy.Horizon(date, observer, equator.ra, equator.dec, 'normal');
  const illumination = Astronomy.Illumination(Astronomy.Body.Moon, date);
  return { azimuthDeg: horizon.azimuth, altitudeDeg: horizon.altitude, phaseFraction: illumination.phase_fraction, source: 'astronomy-engine' };
}

export function computeMoon({ date, lat, lon, heightM = 0, Astronomy = null }) {
  if (!Astronomy) return null;
  try { return astronomyMoon(date, lat, lon, heightM, Astronomy); } catch (_) { return null; }
}

/** Relative (non-photometric) directional intensity for the scene. */
export function moonlightIntensity(moon) {
  if (!moon || moon.altitudeDeg <= 0) return 0;
  return MOONLIGHT_GAIN * Math.max(0, Math.min(1, moon.phaseFraction)) * Math.min(1, Math.sin((moon.altitudeDeg * Math.PI) / 180) * 2.5);
}

const signed = (v) => `${v < 0 ? '−' : '+'}${Math.abs(Math.round(v))}°`;

/**
 * Night overlay text for the selected summit and slider time, or null in
 * daylight. `isNow` keeps the wording "now" only for the live time.
 */
export function nightMessage({ peakName, sun, moon, isNow }) {
  if (!sun || sun.altitudeDeg > 0) return null;
  const when = isNow ? 'now' : 'at the selected time';
  const head = `Night at ${peakName} ${when} (Sun ${signed(sun.altitudeDeg)}) — move the time slider to see daylight`;
  if (!moon || moon.altitudeDeg <= 0) return { text: head, moon: null };
  return {
    text: head,
    moon: `${MOONLIGHT_LABEL} · Moon ${Math.round(moon.phaseFraction * 100)}% illuminated, altitude ${signed(moon.altitudeDeg)}`,
  };
}
