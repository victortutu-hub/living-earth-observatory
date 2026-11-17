// LOT 15: photometric scale shared by the Milky Way background and the point
// stars (constants from the generated config src/config/sky-map.js, derived by
// tools/build-sky-map.mjs from the NASA SVS hiptyc_2020 layer; never by hand).
//   map unit: a texel value Y of the SVS map (relative, linear, clipped at 1.0);
//   star flux F (map unit x equatorial texel solid angle) = 10^(-0.4 (V + ZP));
//   surface brightness mu = -2.5 log10(Y) + K  (V mag/arcsec^2);
//   scene value = map value * sceneScale, sceneScale = (L/Y) / L_ref * 2^N.

export function starFlux(vMag, zeroPoint) {
  return 10 ** (-0.4 * (vMag + zeroPoint));
}

export function surfaceBrightness(value, K) {
  return value > 0 ? -2.5 * Math.log10(value) + K : Infinity;
}

/** Solid angle (sr) of one screen pixel at the centre of a perspective view. */
export function screenPixelSolidAngle(verticalFovDeg, drawingBufferHeight) {
  const radiansPerPixel = (2 * Math.tan((verticalFovDeg * Math.PI) / 360)) / drawingBufferHeight;
  return radiansPerPixel * radiansPerPixel;
}

/** Solid angle (sr) of an equatorial texel of a W x H plate carree map. */
export function equatorialTexelSolidAngle(width, height) {
  return ((2 * Math.PI) / width) * (Math.PI / height);
}

/**
 * Scene value integrated over the screen for a point star: flux * sceneScale *
 * (texel solid angle / screen pixel solid angle) -> "scene value x pixels".
 */
export function starPixelFlux({ flux, sceneScale, texelSolidAngle, pixelSolidAngle }) {
  return (flux * sceneScale * texelSolidAngle) / pixelSolidAngle;
}

/** Point-spread function of a point star on screen: normalised Gaussian (sum over pixels = 1). */
export const STAR_PSF_SIGMA_PX = 0.7;
export const STAR_SPRITE_PX = 5;
