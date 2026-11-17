// LOT 15: star colour from the B-V index, as described for the NASA SVS Deep
// Star Maps 2020: B-V -> effective temperature (the function ascribed to
// F. Ballesteros, 2012) -> black-body colour. Black-body chromaticity from the
// cubic-spline approximation of the Planckian locus (Kim et al. 2002, valid
// 1667-25000 K), XYZ -> linear sRGB (D65). Output: linear RGB with Rec.709
// luminance 1 (the star flux sets the brightness separately).
export function bvToTemperature(bv) {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

export function planckianXY(temperature) {
  const T = Math.min(25000, Math.max(1667, temperature));
  const t = 1e3 / T; const t2 = t * t; const t3 = t2 * t;
  const x = T <= 4000
    ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t + 0.179910
    : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.240390;
  const x2 = x * x; const x3 = x2 * x;
  let y;
  if (T <= 2222) y = -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683;
  else if (T <= 4000) y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
  else y = 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
  return { x, y };
}

/** B-V (or null) -> linear sRGB with luminance 1; null -> white. */
export function bvToLinearRgb(bv) {
  if (!Number.isFinite(bv)) return [1, 1, 1];
  const { x, y } = planckianXY(bvToTemperature(Math.max(-0.4, Math.min(2.0, bv))));
  const X = x / y; const Y = 1; const Z = (1 - x - y) / y;
  let r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  let g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  let b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / lum, g / lum, b / lum];
}
