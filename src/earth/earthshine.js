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

// LOT 31 ETAPA 2b: "Earthshine view" (+10 EV on the whole Moon) only makes sense while the earthshine side
// can be seen. With +10 EV the earthshine side shows at 2^(10 - stops) of the normally exposed sunlit
// surface: at 5 % lit (about 13.3 stops) that is ~1/10 (clearly visible), at 40 % lit (about 14.3 stops
// at the mean distance) ~1/20 (faint but readable), at 75 % lit (about 16.5 stops) ~1/90 (black). The
// threshold is 40 % lit; above it the view is refused, or turned off when the phase crosses it.
export const EARTHSHINE_VIEW_EV = 10;
export const EARTHSHINE_VIEW_MAX_LIT_FRACTION = 0.4;
// Sensor white for the +10 EV view: the Moon output is clipped at this linear value before the tone
// mapping and the bloom, i.e. no brighter than a white sunlit object (a cloud top is ~0.8), so the
// clipped sunlit side cannot drive the bloom like the Sun. Not applied at normal exposure.
export const MOON_SENSOR_WHITE = 1.0;

/** { available, reason } for the Earthshine view at a Moon lit fraction (0-1) and earthshine stops. */
export function earthshineViewAvailability({ litFraction, stops }) {
    const lit = Math.round((Number(litFraction) || 0) * 100);
    if (Number(litFraction) <= EARTHSHINE_VIEW_MAX_LIT_FRACTION) return { available: true, reason: null };
    const below = Number.isFinite(stops) ? `${stops.toFixed(1)} stops below the sunlight` : 'no earthshine';
    return { available: false, reason: `Earthshine too faint at this phase — ${lit} % lit, ${below} (Earthshine view needs ≤ ${Math.round(EARTHSHINE_VIEW_MAX_LIT_FRACTION * 100)} % lit)` };
}

export const EARTHSHINE_VIEW_TITLE = 'Moon exposure +10 EV on the whole Moon: the side lit only by the Earth (physical earthshine) becomes visible and the sunlit side clips at sensor white, as in photographs. Available up to 40 % lit. The Earth is not affected.';

/**
 * LOT 33: why a camera on the night side does not help. Earthshine depends on the Earth's phase seen from the
 * Moon. Its phase angle is the elongation (earthPhaseAngleFromElongationCos), so the Earth's lit fraction is
 * 1 - the Moon's. "nearly new" is used only at <= 10 %; above that the sentence gives the percentage.
 */
export function earthshineViewpointNote(litFraction) {
    const earthLit = Math.round((1 - Math.min(1, Math.max(0, Number(litFraction) || 0))) * 100);
    const phase = earthLit <= 10 ? `now nearly new, ${earthLit} % lit` : `now ${earthLit} % lit`;
    return `The camera may show more of the night side, but earthshine depends on the Earth's phase seen from the Moon (${phase}), so the night side is dark from any viewpoint.`;
}

/**
 * LOT 33: the Earthshine view button.
 * - Above the threshold it is aria-disabled, not `disabled`: it stays focusable and clickable, so a tap on a
 *   phone can point at the explanation (there is no hover on touch screens).
 * - "%" is preceded by a no-break space, so the label cannot wrap as "(97 / % lit)".
 * Returns { ariaDisabled, pressed, text, title }.
 */
export function earthshineViewButtonState({ litFraction, stops, exposureEv }) {
    const { available, reason } = earthshineViewAvailability({ litFraction, stops });
    const active = exposureEv > 0;
    const ariaDisabled = !available && !active;
    const text = active ? `Earthshine view: +${exposureEv} EV`
        : ariaDisabled ? `Earthshine view: unavailable (${Math.round((Number(litFraction) || 0) * 100)} % lit from Earth)`
            : 'Earthshine view: off';
    return { ariaDisabled, pressed: active, text, title: available ? EARTHSHINE_VIEW_TITLE : `${reason}. ${earthshineViewpointNote(litFraction)}` };
}

/** A request for an exposure (0 or +10 EV): { ev, applied, note } - refused above the threshold. */
export function requestEarthshineExposure({ wantedEv, litFraction, stops }) {
    const wanted = Number.isFinite(Number(wantedEv)) ? Math.max(0, Math.min(EARTHSHINE_VIEW_EV, Number(wantedEv))) : 0;
    const availability = earthshineViewAvailability({ litFraction, stops });
    if (wanted > 0 && !availability.available) return { ev: 0, applied: false, note: availability.reason };
    return { ev: wanted, applied: true, note: null };
}

/** After a phase change: { ev, turnedOff, note } - an active view above the threshold turns itself off. */
export function enforceEarthshineExposure({ ev, litFraction, stops }) {
    const availability = earthshineViewAvailability({ litFraction, stops });
    if (ev > 0 && !availability.available) return { ev: 0, turnedOff: true, note: `Earthshine view turned off: ${availability.reason}` };
    return { ev, turnedOff: false, note: null };
}
