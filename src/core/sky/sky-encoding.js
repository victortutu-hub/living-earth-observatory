// LOT 15: 8-bit logarithmic encoding of the sky radiance (NASA SVS Deep Star
// Maps 2020 values: linear, relative, clipped at 1.0). A channel value c in
// [2^LOG_MIN_STOPS, 1] is stored as round(255 * (log2(c) - LOG_MIN_STOPS) / -LOG_MIN_STOPS);
// code 0 means "below the floor" and decodes to 0.
// Quantisation: one code = -LOG_MIN_STOPS / 255 stops; the worst-case error
// (half a code) in magnitudes is QUANTISATION_ERROR_MAG.
export const LOG_MIN_STOPS = -14;
export const STOPS_PER_CODE = -LOG_MIN_STOPS / 255;
export const QUANTISATION_ERROR_MAG = (STOPS_PER_CODE / 2) * 2.5 * Math.log10(2);

export function encodeSkyValue(value) {
  if (!(value > 0)) return 0;
  const stops = Math.log2(Math.min(1, value));
  if (stops < LOG_MIN_STOPS) return 0;
  return Math.max(1, Math.min(255, Math.round((255 * (stops - LOG_MIN_STOPS)) / -LOG_MIN_STOPS)));
}

export function decodeSkyValue(code) {
  if (code <= 0) return 0;
  return 2 ** (LOG_MIN_STOPS + (code / 255) * -LOG_MIN_STOPS);
}

// Colour: chromaticity (r, b) = (R, B) / (R + G + B) stored as 8-bit linear
// codes in a second, lower-resolution cube; RGB = Y * c / luma(c), c = (r, 1-r-b, b).
export const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);
export function encodeChromaticity(r, g, b) {
  const sum = r + g + b;
  if (!(sum > 0)) return [85, 85];
  return [Math.round((255 * r) / sum), Math.round((255 * b) / sum)];
}
export function decodeSkyRgb(luminanceCode, [cr, cb]) {
  const Y = decodeSkyValue(luminanceCode);
  const c = [cr / 255, 1 - cr / 255 - cb / 255, cb / 255];
  const l = LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
  return l > 0 ? c.map((v) => (Y * v) / l) : [0, 0, 0];
}

/** GLSL: luminance code (R8 sample in [0,1]) + chromaticity (RG8 sample) -> linear RGB in map units. */
const LUMA_GLSL = '0.2126, 0.7152, 0.0722';
export const SKY_DECODE_GLSL = `
vec3 lumiDecodeSky(float code, vec2 chroma) {
  // log2 luminance (src/core/sky/sky-encoding.js): code 0 -> 0, else 2^(${LOG_MIN_STOPS.toFixed(1)} + code * ${(-LOG_MIN_STOPS).toFixed(1)}).
  float luminance = code < 0.5 / 255.0 ? 0.0 : exp2(${LOG_MIN_STOPS.toFixed(1)} + code * ${(-LOG_MIN_STOPS).toFixed(1)});
  vec3 c = vec3(chroma.x, 1.0 - chroma.x - chroma.y, chroma.y);
  float l = dot(c, vec3(${LUMA_GLSL}));
  return l > 0.0 ? luminance * c / l : vec3(0.0);
}
`;
