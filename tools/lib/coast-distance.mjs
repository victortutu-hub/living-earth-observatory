// LOT 43: signed distance to the coast from land polygons (lon / lat rings), pure (no I/O), for
// tools/build-coast-distance.mjs and the tests.
//
// Grid: equirectangular, width x height texels, row 0 = NORTH (PNG order), texel centres at
//   lon = -180 + (i + 0.5) * 360 / width,  lat = 90 - (j + 0.5) * 180 / height.
// Sign: land (inside the polygons, even-odd over every ring) +, water -.
// Magnitude: distance (km) from the texel centre to the nearest REAL coast segment, capped at maxKm.
// Not coast (kept for inside / outside, skipped for the distance):
//   - segments on the antimeridian (both ends on the same meridian |lon| = 180: the polygons are cut there),
//   - segments on the south pole (both ends at lat = -90: Antarctica closes through the pole),
//   - segments shared by two rings (Natural Earth splits continents into contiguous pieces).
// Distance: planar in the local tangent plane of the texel (x = dlon * cos(lat), y = dlat; longitude
// differences wrapped to [-180, 180], so the antimeridian is seamless). Error vs the great circle is
// below 0.1 % within maxKm (<= 64 km) for the short Natural Earth segments.
export const EARTH_RADIUS_KM = 6371;
export const KM_PER_DEG = (Math.PI * EARTH_RADIUS_KM) / 180;
const EPS = 1e-7;

/** Rings (Float64Array x0, y0, x1, y1, ...) -> segments { ax, ay, bx, by, coast } plus counts per kind. */
export function classifySegments(rings) {
  const segs = [];
  const key = (x, y) => `${Math.round(x * 1e7)},${Math.round(y * 1e7)}`;
  const seen = new Map();
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let k = 0; k < n; k++) {
      const ax = ring[2 * k]; const ay = ring[2 * k + 1];
      const bx = ring[2 * ((k + 1) % n)]; const by = ring[2 * ((k + 1) % n) + 1];
      if (ax === bx && ay === by) continue;
      const ka = key(ax, ay); const kb = key(bx, by);
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      seen.set(id, (seen.get(id) || 0) + 1);
      segs.push({ ax, ay, bx, by, id });
    }
  }
  const counts = { total: segs.length, coast: 0, antimeridian: 0, pole: 0, shared: 0, maxDegLength: 0, maxLonJump: 0 };
  for (const s of segs) {
    const pole = s.ay < -90 + EPS && s.by < -90 + EPS;
    // on the meridian +180 or -180 itself (a segment from -180 to +180 along a parallel is not a cut)
    const anti = !pole && Math.abs(Math.abs(s.ax) - 180) < EPS && Math.abs(s.bx - s.ax) < EPS;
    const shared = seen.get(s.id) > 1;
    s.coast = !(anti || pole || shared);
    if (anti) counts.antimeridian++; else if (pole) counts.pole++; else if (shared) counts.shared++;
    if (s.coast) {
      counts.coast++;
      counts.maxDegLength = Math.max(counts.maxDegLength, Math.hypot(s.bx - s.ax, s.by - s.ay));
    }
    counts.maxLonJump = Math.max(counts.maxLonJump, Math.abs(s.bx - s.ax));
    delete s.id;
  }
  return { segments: segs, counts };
}

export const texelLon = (i, width) => -180 + ((i + 0.5) * 360) / width;
export const texelLat = (j, height) => 90 - ((j + 0.5) * 180) / height;

/** Even-odd inside test at every texel centre (scanline per row). Uint8Array, 1 = land, row 0 north. */
export function rasterizeInside(segments, width, height) {
  const rows = Array.from({ length: height }, () => []);
  for (const s of segments) {
    if (s.ay === s.by) continue;
    const lo = Math.min(s.ay, s.by); const hi = Math.max(s.ay, s.by);
    // rows whose centre latitude is in [lo, hi)
    const j0 = Math.max(0, Math.ceil(((90 - hi) * height) / 180 - 0.5));
    const j1 = Math.min(height - 1, Math.floor(((90 - lo) * height) / 180 - 0.5));
    for (let j = j0; j <= j1; j++) {
      const lat = texelLat(j, height);
      if ((s.ay > lat) === (s.by > lat)) continue;
      rows[j].push(s.ax + ((lat - s.ay) * (s.bx - s.ax)) / (s.by - s.ay));
    }
  }
  const inside = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    const xs = rows[j].sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(((xs[k] + 180) * width) / 360 - 0.5));
      const i1 = Math.min(width - 1, Math.ceil(((xs[k + 1] + 180) * width) / 360 - 0.5) - 1);
      inside.fill(1, j * width + i0, j * width + i1 + 1);
    }
  }
  return inside;
}

const wrapDeg = (d) => d - 360 * Math.round(d / 360);

/** Unsigned distance (km, capped at maxKm) from each texel centre to the nearest coast segment. */
export function coastDistanceKm(segments, width, height, maxKm) {
  const dist = new Float32Array(width * height).fill(maxKm);
  const degPerRow = 180 / height; const degPerCol = 360 / width;
  const padLat = maxKm / KM_PER_DEG;
  const cosRow = new Float64Array(height);
  for (let j = 0; j < height; j++) cosRow[j] = Math.cos((texelLat(j, height) * Math.PI) / 180);
  for (const s of segments) {
    if (!s.coast) continue;
    const latHi = Math.min(90, Math.max(s.ay, s.by) + padLat); const latLo = Math.max(-90, Math.min(s.ay, s.by) - padLat);
    const j0 = Math.max(0, Math.floor((90 - latHi) / degPerRow - 0.5)); const j1 = Math.min(height - 1, Math.ceil((90 - latLo) / degPerRow - 0.5));
    for (let j = j0; j <= j1; j++) {
      const lat = texelLat(j, height); const c = cosRow[j];
      const dyA = (s.ay - lat) * KM_PER_DEG; const dyB = (s.by - lat) * KM_PER_DEG;
      if (Math.min(Math.abs(dyA), Math.abs(dyB)) > maxKm && Math.sign(dyA) === Math.sign(dyB)) continue;
      // columns within maxKm of the segment's longitude span at this latitude (all of them near the poles)
      const padLon = c * KM_PER_DEG * 180 > maxKm ? maxKm / (KM_PER_DEG * c) : 180;
      const lonLo = Math.min(s.ax, s.bx) - padLon; const lonHi = Math.max(s.ax, s.bx) + padLon;
      const full = lonHi - lonLo >= 360;
      const i0 = full ? 0 : Math.floor((lonLo + 180) / degPerCol - 0.5); const i1 = full ? width - 1 : Math.ceil((lonHi + 180) / degPerCol - 0.5);
      for (let ii = i0; ii <= i1; ii++) {
        const i = ((ii % width) + width) % width;
        const lon = texelLon(i, width);
        // wrap the segment MIDPOINT, then the ends at ± half the span (valid for any span, also > 180 deg)
        const dxM = wrapDeg((s.ax + s.bx) / 2 - lon); const half = (s.bx - s.ax) / 2;
        const dxA = (dxM - half) * c * KM_PER_DEG; const dxB = (dxM + half) * c * KM_PER_DEG;
        const ex = dxB - dxA; const ey = dyB - dyA;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 0 ? Math.min(1, Math.max(0, -(dxA * ex + dyA * ey) / len2)) : 0;
        const d = Math.hypot(dxA + t * ex, dyA + t * ey);
        const k = j * width + i;
        if (d < dist[k]) dist[k] = d;
      }
    }
  }
  return dist;
}

/** Signed field (km): + land, - water, |d| <= maxKm. */
export function signedCoastDistance(segments, width, height, maxKm) {
  const inside = rasterizeInside(segments, width, height);
  const dist = coastDistanceKm(segments, width, height, maxKm);
  for (let k = 0; k < dist.length; k++) if (!inside[k]) dist[k] = -dist[k];
  return { signed: dist, inside };
}

/** 8-bit code: 127.5 + 127.5 * d / maxKm, rounded (the coast is between codes 127 and 128). */
export function encodeCoastDistance(signedKm, maxKm) {
  const out = new Uint8Array(signedKm.length);
  for (let k = 0; k < out.length; k++) out[k] = Math.min(255, Math.max(0, Math.round(127.5 + (127.5 * signedKm[k]) / maxKm)));
  return out;
}

/** Inverse of encodeCoastDistance for a code or a filtered value in [0, 255]. */
export const decodeCoastDistance = (code, maxKm) => ((code - 127.5) / 127.5) * maxKm;
