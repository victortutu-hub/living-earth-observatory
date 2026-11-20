// LOT 31: what lights the Living Earth scene, described from the live light objects (no value of its
// own). The Sun is a physical model (direction from Astronomy Engine); every other contribution is an
// artistic fill (interpretive): the cool directional light opposite the Sun (solar-system.js, intensity
// by Earth look preset), the ambient light (earth-app-bootstrap.js) and, on the Moon only, the emissive
// tint of its material (moon-system.js). Earthshine is not modelled as light; the "earthshine" billboard
// is a decorative halo.

const hex = (color) => `#${color.getHexString()}`;
const n = (value) => String(Number(value.toFixed(2)));

/** "Sun: real direction (physical-model, Astronomy Engine) · directional #ffe6c9 × 2.55" */
export function describeSun(sunLight) {
    return `Sun: real direction (physical-model, Astronomy Engine) · directional ${hex(sunLight.color)} × ${n(sunLight.intensity)}`;
}

/** The artistic fill shared by the Earth and the Moon: cool light opposite the Sun + ambient. */
export function describeArtisticFill({ coolFill, ambientLight, look }) {
    const parts = [];
    if (coolFill) parts.push(`cool directional light opposite the Sun ${hex(coolFill.color)} × ${n(coolFill.intensity)}${look ? ` (look: ${look})` : ''}`);
    if (ambientLight) parts.push(`ambient ${hex(ambientLight.color)} × ${n(ambientLight.intensity)}`);
    return parts;
}

export const EARTHSHINE_NOT_MODELLED = 'earthshine not modelled as light';
export const EARTHSHINE_HALO_LABEL = 'Decorative additive halo around the disc (interpretive): its opacity follows 1 − lit fraction (at most 0.07); it does not light the surface';

/** Moon details, row "Illumination". */
export function describeMoonIllumination({ sunLight, coolFill, ambientLight, moonMaterial, look }) {
    const fill = describeArtisticFill({ coolFill, ambientLight, look });
    if (moonMaterial?.emissive && moonMaterial.emissiveIntensity > 0) fill.push(`emissive tint ${hex(moonMaterial.emissive)} × ${n(moonMaterial.emissiveIntensity)}`);
    return `${describeSun(sunLight)} · plus artistic fill (interpretive): ${fill.join(', ')} — ${EARTHSHINE_NOT_MODELLED}`;
}
