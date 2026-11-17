// LOT 15: pixel <-> magnitude calibration of the NASA SVS Deep Star Maps 2020
// (plate carree, ICRF/J2000, "centered at 0h right ascension, and r.a.
// increases to the left"; linear half-float values, clipped at 1.0).
// The bright-star layer (hiptyc_2020) is measured with aperture photometry on
// isolated, NON-saturated catalogue stars; the fit gives the scale that the
// Milky Way background (milkyway_2020) and the point stars then share.

/** Continuous pixel coordinates (x right, y down; pixel centres at +0.5) of RA/Dec (deg). */
export function equirectPixel(raDeg, decDeg, width, height) {
  const ra = ((raDeg % 360) + 360) % 360;
  let x = width / 2 - (ra / 360) * width; // RA 0h at the centre, RA increasing to the left
  if (x < 0) x += width;
  return { x, y: ((90 - decDeg) / 180) * height };
}

/** RA/Dec (deg) of a continuous pixel position (inverse of equirectPixel). */
export function equirectRaDec(x, y, width, height) {
  const ra = (((width / 2 - x) / width) * 360 + 720) % 360;
  return { raDeg: ra, decDeg: 90 - (y / height) * 180 };
}

export const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]); // linear Rec.709 / sRGB primaries

/**
 * Aperture photometry of catalogue stars on a luminance plane.
 * Stars must be isolated (no catalogue neighbour within `isolationPx` brighter
 * than mag + `isolationDeltaMag`) and not saturated (no channel >= `saturation`
 * inside the integration window). Flux = sum of (Y - local background) * cos(dec)
 * (pixel solid angle relative to an equatorial pixel).
 */
export function measureStars({ stars, catalog, planes, width, height, apertureEqPx = 3, annulus = [5, 7], isolationPx = 7, isolationDeltaMag = 4, saturation = 0.98, maxAbsDec = 60, magRange = [4, 9] }) {
  const { R, G, B } = planes;
  const lum = (i) => LUMA[0] * R[i] + LUMA[1] * G[i] + LUMA[2] * B[i];
  // Spatial hash of the whole catalogue for the isolation test.
  const cell = 8; const grid = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  for (const s of catalog) {
    const p = equirectPixel(s.raDeg, s.decDeg, width, height);
    const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ ...p, mag: s.mag, hip: s.hip });
  }
  const results = []; const rejected = { range: 0, dec: 0, crowded: 0, saturated: 0, edge: 0, nonPositive: 0 };
  for (const s of stars) {
    if (s.mag < magRange[0] || s.mag > magRange[1]) { rejected.range++; continue; }
    if (Math.abs(s.decDeg) > maxAbsDec) { rejected.dec++; continue; }
    const p = equirectPixel(s.raDeg, s.decDeg, width, height);
    const cosd = Math.cos((s.decDeg * Math.PI) / 180);
    const rx = annulus[1] / cosd + 1; const ry = annulus[1] + 1;
    if (p.y - ry < 0 || p.y + ry >= height || p.x - rx < 0 || p.x + rx >= width) { rejected.edge++; continue; }
    let crowded = false;
    const gx = Math.floor(p.x / cell); const gy = Math.floor(p.y / cell);
    for (let dy = -2; dy <= 2 && !crowded; dy++) for (let dx = -2; dx <= 2 && !crowded; dx++) {
      for (const o of grid.get(key(gx + dx, gy + dy)) || []) {
        if (o.hip === s.hip) continue;
        const d = Math.hypot((o.x - p.x) * cosd, o.y - p.y);
        if (d < isolationPx && o.mag < s.mag + isolationDeltaMag) { crowded = true; break; }
      }
    }
    if (crowded) { rejected.crowded++; continue; }
    let sum = 0; let n = 0; let sat = false; const bg = []; let cx = 0; let cy = 0; let cw = 0;
    for (let y = Math.floor(p.y - ry); y <= Math.ceil(p.y + ry); y++) {
      for (let x = Math.floor(p.x - rx); x <= Math.ceil(p.x + rx); x++) {
        const d = Math.hypot((x + 0.5 - p.x) * cosd, y + 0.5 - p.y);
        const i = y * width + x;
        if (d <= apertureEqPx) {
          if (R[i] >= saturation || G[i] >= saturation || B[i] >= saturation) sat = true;
          const v = lum(i); sum += v; n++; cx += v * (x + 0.5); cy += v * (y + 0.5); cw += v;
        } else if (d >= annulus[0] && d <= annulus[1]) bg.push(lum(i));
      }
    }
    if (sat) { rejected.saturated++; continue; }
    bg.sort((a, b) => a - b);
    const background = bg.length ? bg[bg.length >> 1] : 0;
    const flux = (sum - background * n) * cosd;
    if (!(flux > 0)) { rejected.nonPositive++; continue; }
    results.push({ hip: s.hip, mag: s.mag, decDeg: s.decDeg, flux, minst: -2.5 * Math.log10(flux), dx: cw ? (cx / cw - p.x) * cosd : 0, dy: cw ? cy / cw - p.y : 0 });
  }
  return { results, rejected };
}

/** Least squares minst = slope * V + intercept, with iterative 3-sigma clipping. */
export function fitMagnitudes(points, { clip = 3, iterations = 5, fixedSlope = null } = {}) {
  let use = points.slice();
  let fit = null;
  for (let it = 0; it < iterations; it++) {
    const n = use.length;
    const mx = use.reduce((s, p) => s + p.mag, 0) / n;
    const my = use.reduce((s, p) => s + p.minst, 0) / n;
    let slope = fixedSlope;
    if (slope === null) {
      let sxx = 0; let sxy = 0;
      for (const p of use) { sxx += (p.mag - mx) ** 2; sxy += (p.mag - mx) * (p.minst - my); }
      slope = sxy / sxx;
    }
    const intercept = my - slope * mx;
    const res = use.map((p) => p.minst - (slope * p.mag + intercept));
    const rms = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / n);
    fit = { slope, intercept, rms, n };
    const next = use.filter((p) => Math.abs(p.minst - (slope * p.mag + intercept)) <= clip * rms);
    if (next.length === use.length) break;
    use = next;
  }
  return { ...fit, used: use };
}
