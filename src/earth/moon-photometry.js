// LOT 38: lunar surface photometry (physical-model, approximated) and the Moon's auto exposure (interpretive).
//
// Reflectance: McEwen's lunar-Lambert function, as implemented in USGS ISIS (LunarLambertMcEwen.cpp,
// https://isis.astrogeology.usgs.gov/8.1.0/Object/Programmer/_lunar_lambert_mc_ewen_8cpp_source.html;
// McEwen, A. S., 1991, "Photometric functions for photoclinometry and other applications", Icarus 92):
//     r = 2 L(g) mu0 / (mu0 + mu) + (1 - L(g)) mu0,   L(g) = 1 + M1 g + M2 g^2 + M3 g^3   (g in degrees)
// mu0 = cos(incidence), mu = cos(emission), g = phase angle (Sun - surface - camera). L = 1 is Lommel-Seeliger
// (no limb darkening: the full Moon is a flat disc), L = 0 is Lambert. The cubic was fitted to lunar data at
// moderate phase; it crosses 0 at g = 103.95 deg and would go negative (a black crescent), so L is clamped to
// [0, 1]: beyond ~104 deg the surface is treated as Lambert, as McEwen's L tends to there.
// Normalisation: at g = 0, r = 1 everywhere on the disc, while Lambert (r = mu0) averages 2/3 over the
// projected disc; r is multiplied by 2/3 so that the full-Moon disc mean stays where the Lambert rendering was
// (uniform albedo: identical; with the albedo map: measured in tmp/lot38).
//
// Auto exposure (interpretive, LOT 38): ONE exposure for the whole Moon, as an eye or a photographer would set it
// for the crescent. It brings the mean radiance of the sunlit part of the disc back to its full-Moon value:
//     EV(g) = log2( litMean(0) / litMean(g) ),  clamped to [0, MOON_AUTO_EV_MAX]
// litMean is the mean of the normalised lunar-Lambert radiance over the sunlit part of the disc (uniform albedo).
// It is a display choice, not photometry: "fixed" keeps the physical radiance (+0 EV).
// Pure functions, no DOM, no three.js.

export const MCEWEN_LUNAR_LAMBERT = Object.freeze({ m1: -0.019, m2: 0.000242, m3: -0.00000146 });
export const LUNAR_LAMBERT_FULL_MOON_NORMALISATION = 2 / 3;
export const MOON_AUTO_EV_MAX = 3;
export const MOON_EXPOSURE_MODES = Object.freeze(['auto', 'fixed']);
export const MOON_EXPOSURE_DEFAULT_MODE = 'auto';

/** McEwen's L(g), g in degrees, clamped to [0, 1]. */
export function lunarLambertL(phaseDeg) {
    if (!Number.isFinite(phaseDeg)) return 0;
    const g = Math.min(180, Math.max(0, phaseDeg));
    const { m1, m2, m3 } = MCEWEN_LUNAR_LAMBERT;
    return Math.min(1, Math.max(0, 1 + m1 * g + m2 * g * g + m3 * g * g * g));
}

/**
 * Normalised lunar-Lambert radiance factor (the term that replaces Lambert's mu0). 0 on the night side; finite at
 * grazing incidence and emission (the denominator is kept >= 1e-4, the same guard as in the shader).
 */
export function lunarLambert(mu0, mu, phaseDeg) {
    if (!(mu0 > 0)) return 0;
    const m = Math.max(0, Number.isFinite(mu) ? mu : 0);
    const l = lunarLambertL(phaseDeg);
    return LUNAR_LAMBERT_FULL_MOON_NORMALISATION * (2 * l * mu0 / Math.max(mu0 + m, 1e-4) + (1 - l) * mu0);
}

/**
 * Disc statistics of a uniform sphere seen at phase angle g (observer at infinity): the mean of `model` over the
 * sunlit part of the projected disc, over the whole disc, and the sunlit fraction. n x n samples.
 */
export function discStatistics(phaseDeg, { model = lunarLambert, n = 64 } = {}) {
    const g = (Math.min(180, Math.max(0, phaseDeg)) * Math.PI) / 180;
    const sx = Math.sin(g); const sz = Math.cos(g);
    let litSum = 0; let lit = 0; let sum = 0; let count = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const x = ((i + 0.5) / n) * 2 - 1; const y = ((j + 0.5) / n) * 2 - 1; const r2 = x * x + y * y;
            if (r2 > 1) continue;
            const z = Math.sqrt(1 - r2); const mu0 = x * sx + z * sz;
            const v = mu0 > 0 ? model(mu0, z, phaseDeg) : 0;
            sum += v; count++;
            if (mu0 > 0) { litSum += v; lit++; }
        }
    }
    return { litMean: lit ? litSum / lit : 0, discMean: count ? sum / count : 0, litFraction: count ? lit / count : 0 };
}

// litMean at every whole degree (computed once; 181 x 64 x 64 samples, a few ms).
let litMeanTable = null;
function litMeanAt(phaseDeg) {
    if (!litMeanTable) litMeanTable = Array.from({ length: 181 }, (_, g) => discStatistics(g).litMean);
    const g = Math.min(180, Math.max(0, phaseDeg)); const i = Math.floor(g); const t = g - i;
    return i >= 180 ? litMeanTable[180] : litMeanTable[i] * (1 - t) + litMeanTable[i + 1] * t;
}

/** Phase angle (degrees) from the sunlit fraction of the disc k = (1 + cos g) / 2. */
export function phaseAngleFromLitFraction(litFraction) {
    if (!Number.isFinite(litFraction)) return null;
    const k = Math.min(1, Math.max(0, litFraction));
    return (Math.acos(2 * k - 1) * 180) / Math.PI;
}

/** Auto exposure in EV (0 .. MOON_AUTO_EV_MAX), rounded to 0.05 EV; 0 when the phase is unknown or the disc is dark. */
export function moonAutoExposureEv(phaseDeg) {
    if (!Number.isFinite(phaseDeg)) return 0;
    const lm = litMeanAt(phaseDeg);
    if (!(lm > 0)) return MOON_AUTO_EV_MAX;
    const ev = Math.log2(litMeanAt(0) / lm);
    return Math.round(Math.min(MOON_AUTO_EV_MAX, Math.max(0, ev)) * 20) / 20;
}

/**
 * The exposure applied to the Moon. The Earthshine view (+10 EV) is a fixed photographic exposure: it applies over
 * the fixed exposure, never over the auto one (its threshold and the "stops below" figures are relative to +0 EV).
 */
export function effectiveMoonExposureEv({ mode = MOON_EXPOSURE_DEFAULT_MODE, earthshineViewEv = 0, autoEv = 0 }) {
    if (earthshineViewEv > 0) return earthshineViewEv;
    return mode === 'auto' ? Math.max(0, autoEv || 0) : 0;
}

// The EV exactly as applied (it is rounded to 0.05 EV in moonAutoExposureEv): "2.45", "1", "0".
const fmt = (x) => String(Number((Math.round((x || 0) * 20) / 20).toFixed(2)));

/** Moon details, row "Reflectance". */
export function describeMoonReflectance() {
    const { m1, m2, m3 } = MCEWEN_LUNAR_LAMBERT;
    const term = (c, power) => `${c < 0 ? '−' : '+'} ${Math.abs(c)}${power}`;
    return `McEwen lunar-Lambert (physical-model, approximated): r = 2L·μ0/(μ0+μ) + (1−L)·μ0, L(g) = 1 ${term(m1, '·g')} ${term(m2, '·g²')} ${term(m3, '·g³')} (g in degrees), clamped to [0, 1] (Lambert beyond g ≈ 104°); scaled by 2/3 so the full-Moon disc mean matches the previous Lambert rendering. Source: USGS ISIS LunarLambertMcEwen (McEwen 1991, Icarus 92). Applies to the sunlight and the earthshine.`;
}

/** Moon details, row "Exposure" text for the auto / fixed modes (the Earthshine view keeps its own text). */
export function describeMoonAutoExposure({ mode, autoEv }) {
    if (mode === 'fixed') return 'Moon exposure: fixed +0 EV (physical photometry, no compensation)';
    return `Moon exposure: auto +${fmt(autoEv || 0)} EV (interpretive — as an eye or a photographer would expose for the crescent; max +${MOON_AUTO_EV_MAX} EV)`;
}
