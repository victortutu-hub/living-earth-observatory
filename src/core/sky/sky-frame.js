// LOT 15: celestial frames for the real sky. Pure functions (no three.js, no DOM).
//   * ICRS / J2000 unit vectors: x -> RA 0h Dec 0, y -> RA 6h Dec 0, z -> north pole.
//   * Cube map lookup: the GL cube-map convention, with the lookup vector = ICRS vector.
//   * Living Earth scene (Earth-fixed): the geo.js lonLatToVec3 convention,
//     scene = (cos lat cos lon, sin lat, -cos lat sin lon); a sky direction with
//     equator-of-date RA a / Dec d sits at lon = a - GAST, lat = d (the same rule
//     the Sun uses in solar-system.js: Equator(ofdate) and SiderealTime).
// Matrices are row-major arrays [[r0],[r1],[r2]] acting on column vectors.
export const DEG = Math.PI / 180;

export function raDecToVector(raDeg, decDeg) {
  const a = raDeg * DEG; const d = decDeg * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

export function vectorToRaDec([x, y, z]) {
  const r = Math.hypot(x, y, z);
  return { raDeg: ((Math.atan2(y, x) / DEG) + 360) % 360, decDeg: Math.asin(z / r) / DEG };
}

/** GL cube map: face 0..5 = +X,-X,+Y,-Y,+Z,-Z; s,t in [0,1] (row 0 of the face = t near 0). */
export function cubeFaceDirection(face, s, t) {
  const sc = 2 * s - 1; const tc = 2 * t - 1;
  switch (face) {
    case 0: return [1, -tc, -sc];
    case 1: return [-1, -tc, sc];
    case 2: return [sc, 1, tc];
    case 3: return [sc, -1, -tc];
    case 4: return [sc, -tc, 1];
    default: return [-sc, -tc, -1];
  }
}

export function normalize([x, y, z]) { const r = Math.hypot(x, y, z); return [x / r, y / r, z / r]; }
export function apply(m, v) { return [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]); }
export function multiply(a, b) { return [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j])); }
export function transpose(m) { return [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i])); }
/** Vector rotation by +angle (radians) about z / y. */
export function rotZ(a) { const c = Math.cos(a); const s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
export function rotY(a) { const c = Math.cos(a); const s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }

/** Equator-of-date vector (u, v, w) -> Earth scene (u, w, -v) (lonLatToVec3 convention). */
export const EQUATOR_TO_EARTH_SCENE = Object.freeze([[1, 0, 0], [0, 0, 1], [0, -1, 0]]);

const JD_UNIX_EPOCH = 2440587.5;
export function julianCenturiesTT(date) {
  // TT - UTC ~ 69.2 s in 2026 (32.184 + 37 leap seconds): the 1 min-level detail is far below the map texel.
  const jd = date.getTime() / 86400000 + JD_UNIX_EPOCH + 69.184 / 86400;
  return (jd - 2451545.0) / 36525;
}

/** IAU 1976 precession J2000 -> mean equator of date (Lieske 1977); fallback without astronomy-engine. */
export function precessionMatrixApprox(date) {
  const T = julianCenturiesTT(date);
  const as = DEG / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * as;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * as;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * as;
  return multiply(rotZ(z), multiply(rotY(-theta), rotZ(zeta)));
}

/** GMST in hours (IAU 1982, UT1 ~ UTC); fallback without astronomy-engine. */
export function gmstHoursApprox(date) {
  const d = date.getTime() / 86400000 + JD_UNIX_EPOCH - 2451545.0;
  const T = d / 36525;
  const deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T ** 3) / 38710000;
  return ((((deg % 360) + 360) % 360) / 15);
}

/** Precession + nutation J2000 -> true equator of date from astronomy-engine (rows matrix). */
export function precessionMatrixFromAstronomy(Astronomy, date) {
  const rotation = Astronomy.Rotation_EQJ_EQD(date);
  const time = Astronomy.MakeTime(date);
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(([x, y, z]) => {
    const v = Astronomy.RotateVector(rotation, new Astronomy.Vector(x, y, z, time));
    return [v.x, v.y, v.z];
  });
  return [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]]);
}

/**
 * ICRS -> Living Earth scene: EQUATOR_TO_EARTH_SCENE * Rz(-GAST) * P(date).
 * With astronomy-engine: true equator (precession + nutation) and apparent
 * sidereal time; without it: IAU 1976 precession and GMST (labelled approximate).
 */
export function skyToEarthScene({ date, Astronomy = null }) {
  const useEngine = Boolean(Astronomy?.Rotation_EQJ_EQD && Astronomy?.SiderealTime);
  const precession = useEngine ? precessionMatrixFromAstronomy(Astronomy, date) : precessionMatrixApprox(date);
  const siderealHours = useEngine ? Astronomy.SiderealTime(date) : gmstHoursApprox(date);
  const matrix = multiply(EQUATOR_TO_EARTH_SCENE, multiply(rotZ(-siderealHours * 15 * DEG), precession));
  return { matrix, siderealHours, source: useEngine ? 'astronomy-engine' : 'approximate' };
}

/** Earth scene vector -> geographic lon/lat (deg) of the sub-point, as geo.js vec3ToLonLat. */
export function earthSceneToLonLat([x, y, z]) {
  const r = Math.hypot(x, y, z);
  return { lon: ((Math.atan2(-z, x) / DEG + 540) % 360) - 180, lat: Math.asin(y / r) / DEG };
}

/** Ecliptic north pole (J2000, mean obliquity 23.4392911 deg) as an ICRS vector. */
export const ECLIPTIC_POLE_J2000 = Object.freeze(normalize([0, -Math.sin(23.4392911 * DEG), Math.cos(23.4392911 * DEG)]));

// --- LOT 15b: local horizon frame (Living Himalaya and any ground observer).
//   ICRS -> horizontal (N, W, Z): astronomy-engine Rotation_EQJ_HOR (precession, nutation,
//   apparent sidereal time) when the loaded version has it; otherwise
//   R_hor(lat) * Rz(-LST) * P_IAU1976 with LST = GMST + lon (labelled approximate).
//   Refraction is ignored (geometric directions); polar motion and aberration likewise.
//   Horizontal -> scene: scene = N * north + W * (-east) + Z * up, with north/east the
//   local basis of the map projection (projection.js localBasis) and up = +y.

/** Rotation rows from an astronomy-engine RotationMatrix (applied to the basis vectors). */
export function rotationRowsFromAstronomy(Astronomy, rotation, date) {
  const time = Astronomy.MakeTime(date);
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(([x, y, z]) => {
    const v = Astronomy.RotateVector(rotation, new Astronomy.Vector(x, y, z, time));
    return [v.x, v.y, v.z];
  });
  return [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]]);
}

/** ICRS -> horizontal (x north, y west, z zenith), fallback without astronomy-engine. */
export function equatorToHorizonApprox(date, latDeg, lonDeg) {
  const phi = latDeg * DEG;
  const lst = (gmstHoursApprox(date) * 15 + lonDeg) * DEG;
  const local = [[-Math.sin(phi), 0, Math.cos(phi)], [0, -1, 0], [Math.cos(phi), 0, Math.sin(phi)]];
  return multiply(local, multiply(rotZ(-lst), precessionMatrixApprox(date)));
}

/**
 * Horizontal (N, W, Z) -> scene columns [north, -east, up] (y up). North is the projected
 * meridian of localBasis(); the projection is not conformal, so east is rebuilt
 * perpendicular to it (east = north turned 90 deg clockwise seen from above) to keep a
 * pure rotation.
 */
export function horizonToScene(basis) {
  const r = Math.hypot(basis.north.x, basis.north.z);
  const n = [basis.north.x / r, 0, basis.north.z / r];
  const w = [n[2], 0, -n[0]]; // -east, east = (-n.z, 0, n.x)
  return [[n[0], w[0], 0], [n[1], w[1], 1], [n[2], w[2], 0]];
}

/**
 * ICRS -> local scene for an observer at lat/lon (deg) and height (m).
 * @returns {{ matrix: number[][], horizon: number[][], source: 'astronomy-engine'|'approximate' }}
 */
export function skyToHorizonScene({ date, latDeg, lonDeg, heightM = 0, basis, Astronomy = null }) {
  const useEngine = Boolean(Astronomy?.Rotation_EQJ_HOR && Astronomy?.Observer);
  const horizon = useEngine
    ? rotationRowsFromAstronomy(Astronomy, Astronomy.Rotation_EQJ_HOR(date, new Astronomy.Observer(latDeg, lonDeg, heightM)), date)
    : equatorToHorizonApprox(date, latDeg, lonDeg);
  return { matrix: multiply(horizonToScene(basis), horizon), horizon, source: useEngine ? 'astronomy-engine' : 'approximate' };
}

/** Horizontal vector (N, W, Z) -> { azimuthDeg (from north through east), altitudeDeg }. */
export function horizonToAltAz([n, w, z]) {
  const r = Math.hypot(n, w, z);
  return { azimuthDeg: ((Math.atan2(-w, n) / DEG) + 360) % 360, altitudeDeg: Math.asin(z / r) / DEG };
}
