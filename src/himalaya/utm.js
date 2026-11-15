// Living Himalaya LOT 4: WGS84 -> UTM (north hemisphere) with the Krüger
// series to order n^6 (C. F. F. Karney, "Transverse Mercator with an accuracy
// of a few nanometers", J. Geodesy 85, 2011) — the method of GeographicLib.
// Checked against GeographicLib GeoConvert (Everest 45N, K2 43N): < 1 mm.
const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const N3 = F / (2 - F);
const A1 = (A / (1 + N3)) * (1 + N3 ** 2 / 4 + N3 ** 4 / 64 + N3 ** 6 / 256);
const ALPHA = [0,
  N3 / 2 - 2 * N3 ** 2 / 3 + 5 * N3 ** 3 / 16 + 41 * N3 ** 4 / 180 - 127 * N3 ** 5 / 288 + 7891 * N3 ** 6 / 37800,
  13 * N3 ** 2 / 48 - 3 * N3 ** 3 / 5 + 557 * N3 ** 4 / 1440 + 281 * N3 ** 5 / 630 - 1983433 * N3 ** 6 / 1935360,
  61 * N3 ** 3 / 240 - 103 * N3 ** 4 / 140 + 15061 * N3 ** 5 / 26880 + 167603 * N3 ** 6 / 181440,
  49561 * N3 ** 4 / 161280 - 179 * N3 ** 5 / 168 + 6601661 * N3 ** 6 / 7257600,
  34729 * N3 ** 5 / 80640 - 3418889 * N3 ** 6 / 1995840,
  212378941 * N3 ** 6 / 319334400];
const E = Math.sqrt(F * (2 - F));
const RAD = Math.PI / 180;

export function utmZone(lon) {
  return Math.floor((lon + 180) / 6) + 1;
}

/** lat/lon (deg) -> { e, n } metres in UTM zone `zone` (north). */
export function utmForward(lat, lon, zone) {
  const phi = lat * RAD;
  const lam = (lon - ((zone - 1) * 6 - 177)) * RAD;
  const tau = Math.tan(phi);
  const sigma = Math.sinh(E * Math.atanh((E * tau) / Math.sqrt(1 + tau * tau)));
  const taup = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
  const cl = Math.cos(lam);
  const xip = Math.atan2(taup, cl);
  const etap = Math.asinh(Math.sin(lam) / Math.sqrt(taup * taup + cl * cl));
  let xi = xip;
  let eta = etap;
  for (let j = 1; j <= 6; j++) {
    xi += ALPHA[j] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap);
    eta += ALPHA[j] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap);
  }
  return { e: 500000 + K0 * A1 * eta, n: K0 * A1 * xi };
}
