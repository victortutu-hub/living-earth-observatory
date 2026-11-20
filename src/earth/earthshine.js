// LOT 31: physical earthshine on the Moon (physical-model, approximated).
//   E_earthshine / E_sun = p * (R_earth / d)^2 * Phi(alpha_earth)
// p = 0.434: the Earth's geometric albedo (NASA Earth Fact Sheet, "Geometric albedo 0.434"); the Bond
// albedo (0.294 there, ~0.30 from earthshine studies) is a different quantity and is not used here.
// Phi = the Lambert-sphere phase function (an approximation: the real Earth, with clouds and ocean
// glint, is not a Lambert sphere). alpha_earth = the phase angle of the Earth seen from the Moon = the
// Moon's elongation from the Sun seen from the Earth (0 at new Moon: full Earth; 180 deg at full Moon:
// new Earth). d = the Earth-Moon distance from Astronomy Engine. The light comes from the Earth's
// direction (Moon -> Earth), with the colour of the scene sunlight (Earth's spectral reflectance not
// modelled). Pure functions, no DOM.
export const EARTH_GEOMETRIC_ALBEDO = 0.434;
export const EARTH_RADIUS_KM = 6371.0;

/** Lambert-sphere phase function, alpha in radians (clamped to [0, pi]); 1 at alpha 0, 0 at pi. */
export function lambertPhase(alpha) {
    if (!Number.isFinite(alpha)) return 0;
    const a = Math.min(Math.PI, Math.max(0, alpha));
    if (a >= Math.PI) return 0; // exact at the new-Earth end (no floating-point residue)
    return Math.max(0, (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI);
}

/** Earthshine illuminance on the Moon relative to the sunlight (0 when the inputs are not valid). */
export function earthshineRatio({ earthPhaseAngle, distanceKm, albedo = EARTH_GEOMETRIC_ALBEDO, earthRadiusKm = EARTH_RADIUS_KM }) {
    if (!(Number.isFinite(distanceKm) && distanceKm > earthRadiusKm) || !(albedo >= 0)) return 0;
    const solidAngleTerm = (earthRadiusKm / distanceKm) ** 2;
    return albedo * solidAngleTerm * lambertPhase(earthPhaseAngle);
}

/** How many photographic stops the earthshine is below the sunlight (Infinity when it is 0). */
export function stopsBelowSun(ratio) {
    return ratio > 0 ? Math.log2(1 / ratio) : Infinity;
}

/** Earth phase angle seen from the Moon, from the Moon's elongation cosine (Sun-Earth-Moon angle). */
export function earthPhaseAngleFromElongationCos(elongationCos) {
    return Math.acos(Math.min(1, Math.max(-1, Number.isFinite(elongationCos) ? elongationCos : 1)));
}

/** "1.1×10⁻⁴" */
export function formatRatio(ratio) {
    if (!(ratio > 0)) return '0';
    const exp = Math.floor(Math.log10(ratio));
    const mant = ratio / 10 ** exp;
    const sup = String(exp).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
    return `${mant.toFixed(1)}×10${sup}`;
}
