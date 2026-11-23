// LOT 31: what lights the Living Earth scene, described from the live objects (no value of its own).
// The Sun is a physical model (direction from Astronomy Engine). The Earth also gets an artistic fill
// (interpretive): the cool directional light opposite the Sun (solar-system.js, intensity by Earth look
// preset) and the ambient light (earth-app-bootstrap.js). The Moon (ETAPA 2) is lit only by the Sun and
// the physical earthshine (earthshine.js; moon-system.js patches its material).

import { EARTH_GEOMETRIC_ALBEDO, formatRatio } from './earthshine.js';

const hex = (color) => `#${color.getHexString()}`;
const n = (value) => String(Number(value.toFixed(2)));

/** "Sun: real direction (physical-model, Astronomy Engine) · directional #ffe6c9 × 2.55" */
export function describeSun(sunLight) {
    return `Sun: real direction (physical-model, Astronomy Engine) · directional ${hex(sunLight.color)} × ${n(sunLight.intensity)}`;
}

/** The artistic fill of the Earth (LOT 31 ETAPA 2: not the Moon): cool light opposite the Sun + ambient. */
export function describeArtisticFill({ coolFill, ambientLight, look }) {
    const parts = [];
    if (coolFill) parts.push(`cool directional light opposite the Sun ${hex(coolFill.color)} × ${n(coolFill.intensity)}${look ? ` (look: ${look})` : ''}`);
    if (ambientLight) parts.push(`ambient ${hex(ambientLight.color)} × ${n(ambientLight.intensity)}`);
    return parts;
}

/** Moon details, row "Exposure" (LOT 31 ETAPA 2 / 2b: Earthshine view). */
export function describeMoonExposure(exposureEv = 0, note = null) {
    if (exposureEv > 0) return `Moon exposure +${exposureEv} EV (lit side clipped at sensor white, as in photographs)`;
    const normal = 'Normal exposure (+0 EV): the earthshine side is about 13 stops or more below the lit side, so it looks black';
    return note ? `${normal}. ${note}` : `${normal}; use Earthshine view (+10 EV) up to 40 % lit`;
}

/** Moon details, row "Illumination" (LOT 31 ETAPA 2): the Sun and the physical earthshine, no fill. */
export function describeMoonIllumination({ sunLight, earthshine }) {
    const es = earthshine || {};
    const phase = Number.isFinite(es.earthPhaseAngleDeg) ? `Earth phase angle ${Math.round(es.earthPhaseAngleDeg)}°, ` : '';
    const level = es.ratio > 0 ? `${formatRatio(es.ratio)} of the sunlight (${es.stops.toFixed(1)} stops below)` : '0 (new Earth)';
    return `${describeSun(sunLight)} · earthshine (physical-model, approximated: p = ${es.albedo ?? EARTH_GEOMETRIC_ALBEDO} geometric albedo, Lambert phase, from the Earth's direction): ${phase}${level} — no artistic fill on the Moon`;
}
