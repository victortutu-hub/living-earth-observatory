// LOT 33b: the Moon as the CAMERA sees it, kept apart from the Moon as seen from the Earth.
// - Seen from the Earth: phaseFraction in moon-system.js, geocentric. It sets the earthshine intensity and
//   the Earthshine view threshold (40 %).
// - Seen from the camera: the fraction of the visible disc that is sunlit, (1 + cos β) / 2. β is the angle at
//   the Moon between the Sun and the camera, so the camera at the Earth gives the geocentric phase and the
//   camera beyond the Moon gives 1 - phase.
//   Earthshine photographs are taken from the Earth, so they show the crescent. A camera on the sunward side
//   sees a mostly sunlit disc, and at +10 EV that disc clips to white.
// "View from Earth": a camera on the Earth → Moon line. It looks at the Moon from the Earth's side, framed like
// a telephoto earthshine photograph.

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const arr = (v) => (Array.isArray(v) ? v : [v.x, v.y, v.z]);

/** Fraction (0-1) of the visible Moon disc that is sunlit, seen from `cameraPos`. sunDir: unit vector towards the Sun. */
export function cameraLitFraction({ sunDir, moonPos, cameraPos }) {
    const s = norm(arr(sunDir)); const m = arr(moonPos); const c = arr(cameraPos);
    const toCam = norm([c[0] - m[0], c[1] - m[1], c[2] - m[2]]);
    const cos = Math.max(-1, Math.min(1, s[0] * toCam[0] + s[1] * toCam[1] + s[2] * toCam[2]));
    return (1 + cos) / 2;
}

export const EARTH_VIEW_FILL = 0.4; // the Moon's diameter as a fraction of the vertical field of view

/** Camera distance (scene units) at which a Moon of `moonRadius` fills `fill` of a `fovDeg` vertical field. */
export function earthViewDistance({ moonRadius, fovDeg, fill = EARTH_VIEW_FILL }) {
    const half = (fill * fovDeg * Math.PI) / 180 / 2;
    return moonRadius / Math.tan(half);
}

/** The camera position on the Earth → Moon line, `distance` from the Moon on the Earth's side (Earth at the origin). */
export function earthViewCameraPosition({ moonPos, distance }) {
    const m = arr(moonPos); const u = norm(m);
    return [m[0] - u[0] * distance, m[1] - u[1] * distance, m[2] - u[2] * distance];
}

export const CAMERA_HINT_MAX_LIT = 0.4;
export const CAMERA_VIEW_HINT = 'From this viewpoint most of the disc is sunlit — use View from Earth to see the earthshine as photographed.';

/** The hint shows while the Earthshine view is on and the camera sees more than 40 % of the disc sunlit. */
export function cameraViewHint({ active, cameraLit }) {
    return Boolean(active) && Number.isFinite(cameraLit) && cameraLit > CAMERA_HINT_MAX_LIT;
}

/** Moon details row "Phase" (geocentric). */
export function describePhaseFromEarth(phaseFraction) {
    return Number.isFinite(phaseFraction) ? `${Math.round(phaseFraction * 100)}% lit from Earth` : 'unknown';
}

/**
 * LOT 33c: the live rows of the open "The Moon" card. The card is rendered once, on the click; these rows follow
 * the state (the Earthshine view on / off, the phase, the camera). Returns { id: text }.
 */
export function moonCardLiveRows({ phaseFraction, exposureEv, earthshineViewNote, cameraLitFraction }, describeMoonExposure) {
    return {
        moonPhaseValue: describePhaseFromEarth(phaseFraction),
        moonExposureValue: describeMoonExposure(exposureEv, earthshineViewNote),
        moonCameraViewValue: describeCameraView(cameraLitFraction),
    };
}

/** Moon details row. */
export function describeCameraView(cameraLit) {
    return Number.isFinite(cameraLit) ? `${Math.round(cameraLit * 100)} % of the disc sunlit` : 'unknown';
}
