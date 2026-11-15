// Living Himalaya LOT 2: one map projection for everything in the scene
// (overview tiles, GLO-30 patches, summit markers): spherical AZIMUTHAL
// EQUIDISTANT centred on HIMALAYA_REGION_CENTER (31.5°N, 81°E).
// Scene units: 1 unit = 1 km; x east, z south (= -north), y up. Heights are
// metres / 1000 with vertical exaggeration 1.0 (no exaggeration).
// Distances from the centre are exact; the tangential scale error is
// c/sin(c) - 1: about 0.2 % at the summits (640-730 km from the centre) and
// 1.7 % at the region corner (2012 km). The plane does not follow the Earth's
// curvature: this is a flat map with true-scale heights, not a globe.
export const EARTH_RADIUS_KM = 6371.0088;
export const VERTICAL_EXAGGERATION = 1;
const RAD = Math.PI / 180;

/** lon/lat (deg) -> scene {x, z} in km. */
export function projectLonLat(lon, lat, center) {
  const phi = lat * RAD;
  const phi1 = center.lat * RAD;
  const dLambda = (lon - center.lon) * RAD;
  const cosC = Math.sin(phi1) * Math.sin(phi) + Math.cos(phi1) * Math.cos(phi) * Math.cos(dLambda);
  const c = Math.acos(Math.min(1, Math.max(-1, cosC)));
  const k = c < 1e-12 ? 1 : c / Math.sin(c);
  const x = k * Math.cos(phi) * Math.sin(dLambda);
  const y = k * (Math.cos(phi1) * Math.sin(phi) - Math.sin(phi1) * Math.cos(phi) * Math.cos(dLambda));
  return { x: EARTH_RADIUS_KM * x, z: -EARTH_RADIUS_KM * y };
}

/** Scene {x, z} (km) -> {lon, lat} in degrees. */
export function unprojectXZ(x, z, center) {
  const px = x / EARTH_RADIUS_KM;
  const py = -z / EARTH_RADIUS_KM;
  const rho = Math.hypot(px, py);
  if (rho < 1e-15) return { lon: center.lon, lat: center.lat };
  const phi1 = center.lat * RAD;
  const c = rho;
  const lat = Math.asin(Math.cos(c) * Math.sin(phi1) + (py * Math.sin(c) * Math.cos(phi1)) / rho);
  const lon = center.lon * RAD + Math.atan2(px * Math.sin(c), rho * Math.cos(phi1) * Math.cos(c) - py * Math.sin(phi1) * Math.sin(c));
  return { lon: lon / RAD, lat: lat / RAD };
}

/** Height in metres -> scene y in km (exaggeration 1.0). */
export function heightKm(elevationM) {
  return (elevationM / 1000) * VERTICAL_EXAGGERATION;
}

/** Great-circle distance in km. */
export function greatCircleKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2
    + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Local east / north unit vectors in the scene plane at lon/lat. In this
 * projection grid north differs from true north away from the centre
 * (meridian convergence), so directions (sunlight) are rotated with it.
 */
export function localBasis(lon, lat, center) {
  const eps = 1e-4;
  const p = projectLonLat(lon, lat, center);
  const e = projectLonLat(lon + eps, lat, center);
  const n = projectLonLat(lon, lat + eps, center);
  const el = Math.hypot(e.x - p.x, e.z - p.z);
  const nl = Math.hypot(n.x - p.x, n.z - p.z);
  return {
    east: { x: (e.x - p.x) / el, z: (e.z - p.z) / el },
    north: { x: (n.x - p.x) / nl, z: (n.z - p.z) / nl },
  };
}
