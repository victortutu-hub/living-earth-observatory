// Shared physics of Earth's atmosphere: one set of constants and one analytic
// optical-depth model, used by the atmosphere shell (atmosphere.js) and by the
// aerial perspective on the Earth surface (earth-material.js, night-lights.js).
//
// Model: exponential Rayleigh and Mie density profiles; the optical depth of a
// path to space uses the Chapman grazing-incidence function with Schüler's
// approximation (GPU Pro 3, 2012):
//   Ch(X, mu) ~= c / ((c - 1) mu + 1),  c = sqrt(pi X / 2),  mu >= 0
//   Ch(X, mu) = 2 Ch(x0, 0) e^(X - x0) - Ch(X, -mu),  x0 = X sqrt(1 - mu^2),  mu < 0
// where X = r / H. The optical depth between two points on one ray is the
// difference of their columns to space, so the same functions also work for a
// camera inside the atmosphere (low altitude), not only from orbit.
//
// The JS functions below mirror the GLSL ones exactly; tests exercise the JS.

export const ATMOSPHERE = Object.freeze({
    metersPerSceneUnit: 3185500,      // Earth radius 2.0 scene units = 6371 km
    earthRadiusM: 6371000,
    atmosphereRadiusM: 6471000,
    betaRayleigh: Object.freeze([5.8e-6, 13.5e-6, 33.1e-6]),  // 1/m at sea level (R, G, B)
    rayleighScaleHeightM: 7994,       // ~8 km
    betaMie: 21.0e-6,                 // 1/m at sea level
    mieScaleHeightM: 1200,            // 1.2 km
    mieG: 0.76,
    sunIntensity: 16.0,               // E_sun: the shell's uPhysicalIntensity exposure
    haze: 0.55,                       // Mie haze multiplier (shell uPhysicalHaze)
    skyGain: 0.72,                    // display gain applied to scattered light by the shell
});

const MAX_CHAPMAN = 1e9;              // beyond this the path is opaque

export function chapman(X, mu) {
    const c = Math.sqrt(Math.PI * X / 2);
    if (mu >= 0) return c / ((c - 1) * mu + 1);
    const x0 = X * Math.sqrt(Math.max(0, 1 - mu * mu));
    const c0 = Math.sqrt(Math.PI * x0 / 2);
    const value = 2 * c0 * Math.exp(Math.min(80, X - x0)) - c / ((c - 1) * -mu + 1);
    return Math.min(MAX_CHAPMAN, value);
}

/** Optical depth (metres of sea-level-equivalent air) from radius r along direction cosine mu to space. */
export function columnToSpace(radiusM, mu, scaleHeightM, { earthRadiusM = ATMOSPHERE.earthRadiusM } = {}) {
    return scaleHeightM * Math.exp(-(radiusM - earthRadiusM) / scaleHeightM) * chapman(radiusM / scaleHeightM, mu);
}

const length3 = (v) => Math.hypot(v[0], v[1], v[2]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale3 = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** [tauRayleigh, tauMie] along the segment a -> b (Earth-centred metres). */
export function opticalDepthBetween(a, b, atmosphere = ATMOSPHERE) {
    const d = scale3(sub3(b, a), 1 / length3(sub3(b, a)));
    const ra = length3(a); const rb = length3(b);
    const muA = dot3(a, d) / ra; const muB = dot3(b, d) / rb;
    const H = [atmosphere.rayleighScaleHeightM, atmosphere.mieScaleHeightM];
    return H.map((h) => Math.max(0, columnToSpace(ra, muA, h, atmosphere) - columnToSpace(rb, muB, h, atmosphere)));
}

/** Extinction exponent per channel; same expression as the shell's raymarch. */
export function extinction([tauR, tauM], { haze = ATMOSPHERE.haze, betaRayleigh = ATMOSPHERE.betaRayleigh, betaMie = ATMOSPHERE.betaMie } = {}) {
    return betaRayleigh.map((beta) => beta * tauR + betaMie * haze * (tauR + tauM));
}

/** Per-channel transmittance [R, G, B] between two points (metres). */
export function transmittanceBetween(a, b, options = {}) {
    const atmosphere = { ...ATMOSPHERE, ...options };
    return extinction(opticalDepthBetween(a, b, atmosphere), atmosphere).map((value) => Math.exp(-value));
}

/** View transmittance from a surface point (scene units) to the camera (scene units). */
export function surfaceToCameraTransmittance(surfaceUnits, cameraUnits, options = {}) {
    const atmosphere = { ...ATMOSPHERE, ...options };
    const n = scale3(surfaceUnits, 1 / length3(surfaceUnits));
    const a = scale3(n, atmosphere.earthRadiusM + 1);
    const b = scale3(cameraUnits, atmosphere.metersPerSceneUnit);
    return transmittanceBetween(a, b, atmosphere);
}

const f = (value) => {
    const text = Number(value).toString();
    return /[.eE]/.test(text) ? text : `${text}.0`;
};

// GLSL for the same constants and functions. Names of the constants match the
// shell's raymarch (atmosphere.js) so it can use them unchanged.
export const ATMOSPHERE_GLSL = `
const float M_PER_UNIT = ${f(ATMOSPHERE.metersPerSceneUnit)};
const float R_E = ${f(ATMOSPHERE.earthRadiusM)};
const float R_A = ${f(ATMOSPHERE.atmosphereRadiusM)};
const vec3 BETA_R = vec3(${ATMOSPHERE.betaRayleigh.map(f).join(', ')});
const float H_R = ${f(ATMOSPHERE.rayleighScaleHeightM)};
const float BETA_M = ${f(ATMOSPHERE.betaMie)};
const float H_M = ${f(ATMOSPHERE.mieScaleHeightM)};
const float G_MIE = ${f(ATMOSPHERE.mieG)};
const float ATMO_SKY_GAIN = ${f(ATMOSPHERE.skyGain)};

float phaseR(float mu) {
    return 0.75 * (1.0 + mu * mu);
}

float phaseM(float mu) {
    float g = G_MIE;
    float g2 = g * g;
    float denom = pow(max(0.0, 1.0 + g2 - 2.0 * g * mu), 1.5);
    return 0.5 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * denom);
}

vec3 atmoExtinction(vec2 tau, float haze) {
    return BETA_R * tau.x + BETA_M * haze * (tau.x + tau.y);
}

float atmoChapman(float X, float mu) {
    float c = sqrt(1.5707963 * X);
    if (mu >= 0.0) return c / ((c - 1.0) * mu + 1.0);
    float x0 = X * sqrt(max(0.0, 1.0 - mu * mu));
    float c0 = sqrt(1.5707963 * x0);
    return min(${f(MAX_CHAPMAN)}, 2.0 * c0 * exp(min(80.0, X - x0)) - c / ((c - 1.0) * -mu + 1.0));
}

float atmoColumnToSpace(float r, float mu, float H) {
    return H * exp(-(r - R_E) / H) * atmoChapman(r / H, mu);
}

// (tauRayleigh, tauMie) along the segment a -> b, Earth-centred metres.
vec2 atmoOpticalDepth(vec3 a, vec3 b) {
    vec3 d = normalize(b - a);
    float ra = length(a);
    float rb = length(b);
    float muA = dot(a, d) / ra;
    float muB = dot(b, d) / rb;
    return max(vec2(
        atmoColumnToSpace(ra, muA, H_R) - atmoColumnToSpace(rb, muB, H_R),
        atmoColumnToSpace(ra, muA, H_M) - atmoColumnToSpace(rb, muB, H_M)
    ), vec2(0.0));
}

// View transmittance surface -> camera (scene units). The surface point is
// taken on the R_E sphere: the rendered relief is exaggerated, the physical
// air column is not.
vec3 atmoViewTransmittance(vec3 surfaceWorld, vec3 cameraWorld, float haze) {
    vec3 a = normalize(surfaceWorld) * (R_E + 1.0);
    vec3 b = cameraWorld * M_PER_UNIT;
    return exp(-atmoExtinction(atmoOpticalDepth(a, b), haze));
}

// Single-scattering aerial perspective: radiance scattered into the view ray
// between the surface and the camera, with the sun transmittance taken at the
// surface point. Physical units of the surface lighting: sunIrradiance is the
// scene's sun light (colour x intensity, the same irradiance that lights the
// ground) and the phase functions are normalised by 1/(4 pi), so haze and
// ground radiance are directly comparable and added linearly before tone mapping.
const float ATMO_INV_4PI = 0.0795774715;
vec3 atmoAerialInscatter(vec3 surfaceWorld, vec3 cameraWorld, vec3 sunDir, float haze, vec3 sunIrradiance, out vec3 transmittance) {
    vec3 n = normalize(surfaceWorld);
    vec3 a = n * (R_E + 1.0);
    vec3 b = cameraWorld * M_PER_UNIT;
    vec2 tauV = atmoOpticalDepth(a, b);
    vec3 extV = atmoExtinction(tauV, haze);
    transmittance = exp(-extV);
    float muS = dot(n, sunDir);
    vec2 tauS = vec2(atmoColumnToSpace(R_E + 1.0, muS, H_R), atmoColumnToSpace(R_E + 1.0, muS, H_M));
    vec3 sunT = exp(-atmoExtinction(tauS, haze));
    float mu = dot(normalize(a - b), sunDir);
    vec3 scatter = (BETA_R * phaseR(mu) * tauV.x + BETA_M * haze * phaseM(mu) * tauV.y) * ATMO_INV_4PI;
    return sunIrradiance * sunT * scatter * (1.0 - transmittance) / max(extV, vec3(1e-6));
}
`;
