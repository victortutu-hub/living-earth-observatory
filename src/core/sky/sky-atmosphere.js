// LOT 15b: sky brightness seen from the ground (Living Himalaya), V band, luminance in cd/m^2.
// Pure functions (no three.js, no DOM) + the GLSL that mirrors them in the sky shader.
//   NIGHT (observed): SVS Milky Way map (Lot 15 photometric scale, unchanged) and HYG stars,
//     dimmed by extinction 10^(-0.4 k X), X = Kasten & Young 1989 (Appl. Opt. 28, 4735);
//     plus the dark-sky residual: Patat 2003 zenith V = 21.6 mag/arcsec^2 minus the SVS map
//     starlight at |b| > 60 deg (so starlight is not counted twice), brightened towards the
//     horizon with the Krisciunas & Schaefer 1991 form X 10^(-0.4 k (X - 1)),
//     X = (1 - 0.96 sin^2 z)^-1/2 (as restated in Noll et al. 2012, eq. 17).
//   TWILIGHT (observed, empirical fit): Patat, Ugolnikov & Postylyakov 2006 (A&A 455, 385),
//     Table 1, V: mu = a0 + a1 (zeta - 95) + a2 (zeta - 95)^2 for the ZENITH, 95 <= zeta <= 105;
//     night level reached at 105-106 deg. Cerro Paranal (2635 m), applied unchanged at 5-9 km
//     (extrapolation, declared). Angular structure: the zenith value with the same airmass
//     brightening as the dark sky (the glow towards the Sun is not modelled). V band only:
//     achromatic.
//   TRANSITION zeta 90-95 (interpretive): logarithmic interpolation between the day model with
//     the Sun on the horizon and the twilight fit at zeta = 95.
//   DAY (interpretive): Preetham et al. 1999 as implemented in three.js r185 examples/jsm/objects/
//     Sky.js (MIT, see NOTICE.md), in-scattering term only (no sun disc, no clouds, no night
//     floor), Rayleigh scaled by P(h)/P0. Non-photometric: the absolute scale is anchored so the
//     zenith with the Sun on the horizon equals the twilight fit continued linearly to zeta = 90
//     (mu = a0 - 5 a1).
//   EXTINCTION k (V, mag/airmass): Buton et al. 2013 (A&A 549, A8), Table 6 at 5500 A, Mauna Kea
//     (616 mbar): Rayleigh 0.064, ozone 0.024, aerosols 0.018; Rayleigh scaled by P(h)/616 hPa
//     (ISA pressure), ozone and aerosols kept (conservative at 5-9 km).
//   EXPOSURE: E = target / L_ref, L_ref = model background (no map) at 45 deg altitude opposite
//     the Sun plus the mean high-latitude starlight; E clamped to [E_min, E_max]; Reinhard tone
//     curve on luminance, in the sky shader only.
//   Not modelled: refraction (geometric directions), horizon dip, moonlight on the sky, clouds.
import { SKY_MAP_ASSET } from '../../config/sky-map.js';

export const MAG0_CDM2 = 108000; // 0 V mag/arcsec^2 in cd/m^2 (the Lot 15 yToCdm2 uses the same constant)
export const DEG = Math.PI / 180;

export const SKY_MODEL = Object.freeze({
  twilight: Object.freeze({ a0: 11.84, a1: 1.518, a2: -0.057, sigmaMag: 0.18, zetaMin: 95, zetaMax: 105, nightZeta: 106, siteHeightM: 2635,
    source: 'Patat, Ugolnikov & Postylyakov 2006, A&A 455, 385, Table 1 (V)' }),
  darkZenithV: 21.6, darkZenithSource: 'Patat 2003, A&A 400, 1183 (UBVRI night-sky brightness at Paranal, zenith V 21.6)',
  // SVS map starlight, solid-angle weighted mean at |b| > 60 deg, from the shipped luminance cube
  // (tmp/lot15b/residual.mjs; |b| > 75 deg gives 23.32): residual = 21.6 (-) 23.22 = 21.88.
  svsHighLatitudeV: 23.2216,
  extinction: Object.freeze({ rayleigh: 0.064, ozone: 0.024, aerosol: 0.018, referenceHpa: 616, wavelengthA: 5500,
    source: 'Buton et al. 2013, A&A 549, A8, Table 6 (Mauna Kea median extinction, 5500 A)' }),
  kastenYoung: Object.freeze({ a: 0.50572, b: 96.07995, c: 1.6364, source: 'Kasten & Young 1989, Applied Optics 28, 4735' }),
  ksAirmass: 0.96,
  day: Object.freeze({ turbidity: 2, rayleigh: 1, mieCoefficient: 0.005, mieDirectionalG: 0.8, source: 'Preetham, Shirley & Smits 1999; three.js r185 Sky.js (MIT)' }),
  exposure: Object.freeze({ target: 0.18, referenceAltitudeDeg: 45, eMin: 1e-7, eMaxCandidates: Object.freeze([15, 50, 150]), eMax: 50 }), // LOT 18: E_max = 50 final (aesthetic choice, from the Lot 15b captures)
  overviewHeightM: 5000,
});

const ln10 = Math.log(10);
export const magToCdm2 = (mu) => MAG0_CDM2 * 10 ** (-0.4 * mu);
export const cdm2ToMag = (L) => -2.5 * Math.log10(L / MAG0_CDM2);

/** ISA troposphere pressure (hPa), valid below 11 km. */
export function pressureIsaHpa(heightM) {
  return 1013.25 * (1 - 2.25577e-5 * heightM) ** 5.25588;
}

/** V-band extinction coefficient (mag/airmass) at observer height h. */
export function extinctionV(heightM) {
  const e = SKY_MODEL.extinction;
  return e.rayleigh * (pressureIsaHpa(heightM) / e.referenceHpa) + e.ozone + e.aerosol;
}

/** Kasten & Young 1989 relative airmass, z in degrees (finite at the horizon: X(90) ~ 38). */
export function kastenYoungAirmass(zDeg) {
  const { a, b, c } = SKY_MODEL.kastenYoung;
  const z = Math.min(90, Math.max(0, zDeg));
  return 1 / (Math.cos(z * DEG) + a * (b - z) ** -c);
}

/** Krisciunas & Schaefer airmass for scattered/emitted sky light (X(90) = 5). */
export function ksAirmass(zDeg) {
  const s = Math.sin(Math.min(90, Math.max(0, zDeg)) * DEG);
  return (1 - SKY_MODEL.ksAirmass * s * s) ** -0.5;
}

/** Dark-sky brightening towards the horizon: X 10^(-0.4 k (X - 1)). */
export function darkSkyFactor(zDeg, k) {
  const X = ksAirmass(zDeg);
  return X * 10 ** (-0.4 * k * (X - 1));
}

export const transmission = (zDeg, k) => 10 ** (-0.4 * k * kastenYoungAirmass(zDeg));

/** Patat et al. 2006 V-band zenith twilight brightness (mag/arcsec^2); valid 95-105 deg. */
export function patatTwilightMu(zetaDeg) {
  const { a0, a1, a2 } = SKY_MODEL.twilight;
  const x = zetaDeg - 95;
  return a0 + a1 * x + a2 * x * x;
}

export const darkResidualCdm2 = () => magToCdm2(SKY_MODEL.darkZenithV) - magToCdm2(SKY_MODEL.svsHighLatitudeV);
export const highLatitudeStarlightCdm2 = () => magToCdm2(SKY_MODEL.svsHighLatitudeV);

/** Twilight light above the dark sky at the zenith (cd/m^2), for zeta >= 95. */
export function twilightExcessCdm2(zetaDeg) {
  const { zetaMax, nightZeta } = SKY_MODEL.twilight;
  const dark = magToCdm2(SKY_MODEL.darkZenithV);
  const excessAt = (z) => Math.max(0, magToCdm2(patatTwilightMu(z)) - dark);
  if (zetaDeg >= nightZeta) return 0;
  if (zetaDeg > zetaMax) return excessAt(zetaMax) * (nightZeta - zetaDeg) / (nightZeta - zetaMax);
  return excessAt(Math.max(95, zetaDeg));
}

// --- Preetham day sky (three.js r185 Sky.js, in-scattering only), JS mirror of the GLSL below.
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUTOFF_ANGLE = 1.6110731556870734;
const STEEPNESS = 1.5;
const EE = 1000;

/** Per-Sun constants of the day model (the Sky.js vertex stage); sunDir unit, y up. */
export function preethamParams(sunDir, heightM) {
  const { turbidity, rayleigh, mieCoefficient } = SKY_MODEL.day;
  const pressureScale = pressureIsaHpa(heightM) / 1013.25;
  const cosZ = Math.max(-1, Math.min(1, sunDir[1]));
  const sunE = EE * Math.max(0, 1 - Math.exp(-((CUTOFF_ANGLE - Math.acos(cosZ)) / STEEPNESS)));
  // Sky.js: rayleighCoefficient = rayleigh - (1 - sunfade); sunfade = 1 for a unit Sun vector.
  const betaR = TOTAL_RAYLEIGH.map((v) => v * rayleigh * pressureScale);
  const c = 0.2 * turbidity * 10e-18;
  const betaM = MIE_CONST.map((v) => 0.434 * c * v * mieCoefficient);
  return { sunDir, sunE, betaR, betaM, pressureScale };
}

/** Relative linear RGB of the day sky in direction dir (unit, y up). */
export function preethamSkyRgb(dir, p) {
  const g = SKY_MODEL.day.mieDirectionalG;
  const up = Math.max(0, dir[1]);
  const zenithAngle = Math.acos(up);
  const inverse = 1 / (Math.cos(zenithAngle) + 0.15 * (93.885 - (zenithAngle * 180) / Math.PI) ** -1.253);
  const sR = 8.4e3 * inverse; const sM = 1.25e3 * inverse;
  const cosTheta = dir[0] * p.sunDir[0] + dir[1] * p.sunDir[1] + dir[2] * p.sunDir[2];
  const rc = cosTheta * 0.5 + 0.5;
  const rPhase = 0.05968310365946075 * (1 + rc * rc);
  const g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / (1 - 2 * g * cosTheta + g2) ** 1.5);
  const horizonMix = Math.min(1, Math.max(0, (1 - p.sunDir[1]) ** 5));
  return [0, 1, 2].map((i) => {
    const fex = Math.exp(-(p.betaR[i] * sR + p.betaM[i] * sM));
    const ratio = (p.betaR[i] * rPhase + p.betaM[i] * mPhase) / (p.betaR[i] + p.betaM[i]);
    let lin = (p.sunE * ratio * (1 - fex)) ** 1.5;
    lin *= 1 + ((p.sunE * ratio * fex) ** 0.5 - 1) * horizonMix;
    return lin * 0.04;
  });
}

export const LUMA = [0.2126, 0.7152, 0.0722];
const luma = (c) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];

/** Unit vector (y up) towards altitude/azimuth, with the scene basis {north, east} (x/z). */
export function sceneDirection(azimuthDeg, altitudeDeg, basis) {
  const az = azimuthDeg * DEG; const alt = altitudeDeg * DEG;
  const e = Math.sin(az) * Math.cos(alt); const n = Math.cos(az) * Math.cos(alt);
  return [basis.east.x * e + basis.north.x * n, Math.sin(alt), basis.east.z * e + basis.north.z * n];
}

/** Clamp the exposure to [eMin, eMax]. */
export function exposureFor(referenceCdm2, { target, eMin, eMax } = SKY_MODEL.exposure) {
  return Math.min(eMax, Math.max(eMin, target / referenceCdm2));
}

/**
 * Per-update sky state (uniform values) for the Sun at azimuth/altitude seen from heightM.
 * @returns {object} regime, k, nightCdm2 (zenith residual + twilight), day anchor and blend, exposure, ...
 */
export function skyState({ sunAzimuthDeg, sunAltitudeDeg, heightM, basis, eMax = SKY_MODEL.exposure.eMax }) {
  const zeta = 90 - sunAltitudeDeg;
  const k = extinctionV(heightM);
  const residual = darkResidualCdm2();
  const twilight = zeta >= 95 ? twilightExcessCdm2(zeta) : twilightExcessCdm2(95);
  const nightCdm2 = residual + twilight;
  // Day model: the actual Sun above the horizon, the Sun on the horizon for the transition.
  const daySun = sceneDirection(sunAzimuthDeg, Math.max(0, sunAltitudeDeg), basis);
  const day = preethamParams(daySun, heightM);
  const horizonSun = preethamParams(sceneDirection(sunAzimuthDeg, 0, basis), heightM);
  const anchorCdm2 = magToCdm2(SKY_MODEL.twilight.a0 - 5 * SKY_MODEL.twilight.a1);
  const dayAnchor = anchorCdm2 / luma(preethamSkyRgb([0, 1, 0], horizonSun));
  const dayBlend = zeta <= 90 ? 0 : zeta >= 95 ? 1 : (zeta - 90) / 5;
  const regime = zeta < 90 ? 'day' : zeta < 95 ? 'transition' : zeta < SKY_MODEL.twilight.nightZeta ? 'twilight' : 'night';
  const state = { regime, zeta, sunAltitudeDeg, k, residualCdm2: residual, twilightCdm2: twilight, nightCdm2, dayAnchor, dayBlend, day, heightM };
  const refDir = sceneDirection(sunAzimuthDeg + 180, SKY_MODEL.exposure.referenceAltitudeDeg, basis);
  const refZ = 90 - SKY_MODEL.exposure.referenceAltitudeDeg;
  state.referenceCdm2 = luma(atmosphereRgb(refDir, state)) + highLatitudeStarlightCdm2() * transmission(refZ, k);
  state.exposure = exposureFor(state.referenceCdm2, { ...SKY_MODEL.exposure, eMax });
  state.eMax = eMax;
  return state;
}

/** Atmosphere (no map, no stars) in direction dir: linear RGB in cd/m^2 (JS mirror of the GLSL). */
export function atmosphereRgb(dir, s) {
  const cz = Math.min(1, Math.max(0, dir[1]));
  const zDeg = Math.acos(cz) / DEG;
  const night = s.nightCdm2 * darkSkyFactor(zDeg, s.k);
  if (s.dayBlend >= 1) return [night, night, night];
  const flat = [dir[0], Math.max(0, dir[1]), dir[2]];
  const r = Math.hypot(...flat) || 1;
  const day = preethamSkyRgb(flat.map((v) => v / r), s.day).map((v) => Math.max(1e-12, v * s.dayAnchor));
  if (s.dayBlend <= 0) return day;
  return day.map((v) => Math.exp((1 - s.dayBlend) * Math.log(v) + s.dayBlend * Math.log(night)));
}

/** Reinhard on luminance (display value of a linear RGB already multiplied by the exposure). */
export function toneMap(rgb) {
  const y = luma(rgb);
  return rgb.map((v) => v / (1 + y));
}

/** Lot 15 photometric scale for the map and the stars (unchanged): map value -> cd/m^2. */
export const MAP_TO_CDM2 = SKY_MAP_ASSET.exposure.yToCdm2;

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
export const SKY_ATMOSPHERE_GLSL = `
const vec3 LUMI_LUMA = vec3(${LUMA.join(', ')});
float lumiKastenYoung(float cz) {
  float zDeg = degrees(acos(cz));
  return 1.0 / (cz + ${SKY_MODEL.kastenYoung.a} * pow(${SKY_MODEL.kastenYoung.b} - zDeg, -${SKY_MODEL.kastenYoung.c}));
}
float lumiDarkSkyFactor(float cz, float k) {
  float X = inversesqrt(1.0 - ${SKY_MODEL.ksAirmass} * (1.0 - cz * cz));
  return X * pow(10.0, -0.4 * k * (X - 1.0));
}
vec3 lumiPreetham(vec3 dir, vec3 sunDir, float sunE, vec3 betaR, vec3 betaM) {
  float zenithAngle = acos(max(0.0, dir.y));
  float inverse = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / 3.141592653589793), -1.253));
  float sR = 8.4E3 * inverse;
  float sM = 1.25E3 * inverse;
  vec3 Fex = exp(-(betaR * sR + betaM * sM));
  float cosTheta = dot(dir, sunDir);
  float rc = cosTheta * 0.5 + 0.5;
  float rPhase = 0.05968310365946075 * (1.0 + rc * rc);
  float g = ${f(SKY_MODEL.day.mieDirectionalG)};
  float g2 = g * g;
  float mPhase = 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5));
  vec3 ratio = (betaR * rPhase + betaM * mPhase) / (betaR + betaM);
  vec3 Lin = pow(sunE * ratio * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(sunE * ratio * Fex, vec3(0.5)), clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));
  return Lin * 0.04;
}
`;
