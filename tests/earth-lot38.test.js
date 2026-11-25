// LOT 38 PAS 1: McEwen lunar-Lambert reflectance on the Moon (physical-model, approximated) and the Moon's auto / fixed
// exposure (auto = interpretive compensation from the phase; fixed = +0 EV, the physical photometry).
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LUNAR_LAMBERT_FULL_MOON_NORMALISATION, MCEWEN_LUNAR_LAMBERT, MOON_AUTO_EV_MAX, MOON_EXPOSURE_DEFAULT_MODE,
  describeMoonAutoExposure, describeMoonReflectance, discStatistics, effectiveMoonExposureEv, lunarLambert, lunarLambertL,
  moonAutoExposureEv, phaseAngleFromLitFraction,
} from '../src/earth/moon-photometry.js';
import { MOON_LUNAR_LAMBERT_GLSL, MOON_LIGHTING_CHUNKS, patchMoonLightingShader } from '../src/earth/moon-system.js';
import { describeMoonExposure } from '../src/earth/scene-lighting.js';
import { moonCardLiveRows } from '../src/earth/moon-viewpoint.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const lambert = (mu0) => (mu0 > 0 ? mu0 : 0);
const G10 = phaseAngleFromLitFraction(0.1); // 10 % crescent, g = 143.13 deg
const G5 = phaseAngleFromLitFraction(0.05);

describe('LOT 38: McEwen lunar-Lambert (USGS ISIS LunarLambertMcEwen)', () => {
  it('the coefficients are the ISIS ones; L(g) = 1 at 0, decreasing, clamped to [0, 1] (0 beyond 103.95 deg, never negative)', () => {
    expect(MCEWEN_LUNAR_LAMBERT).toEqual({ m1: -0.019, m2: 0.000242, m3: -0.00000146 });
    expect(lunarLambertL(0)).toBe(1);
    expect(lunarLambertL(30)).toBeCloseTo(1 - 0.57 + 0.2178 - 0.03942, 6);
    expect(lunarLambertL(90)).toBeCloseTo(0.1858, 3);
    expect(lunarLambertL(103.9)).toBeGreaterThan(0);
    expect(lunarLambertL(104)).toBe(0);
    for (const g of [120, 143.13, 160, 180]) expect(lunarLambertL(g)).toBe(0);
    for (let g = 0; g < 180; g += 1) expect(lunarLambertL(g + 1)).toBeLessThanOrEqual(lunarLambertL(g));
    expect(lunarLambertL(Number.NaN)).toBe(0);
  });

  it('full Moon: no limb darkening (centre / edge = 1; Lambert -> 0) and the disc mean of the Lambert rendering is kept', () => {
    const centre = lunarLambert(1, 1, 0); const edge = lunarLambert(0.02, 0.02, 0);
    expect(centre / edge).toBeCloseTo(1, 10);
    expect(lambert(1) / lambert(0.02)).toBe(50); // Lambert: the edge goes to 0
    const nw = discStatistics(0, { n: 200 }).discMean; const old = discStatistics(0, { model: lambert, n: 200 }).discMean;
    expect(Math.abs(nw / old - 1)).toBeLessThan(0.005);
    expect(LUNAR_LAMBERT_FULL_MOON_NORMALISATION).toBeCloseTo(2 / 3, 12);
  });

  it('fixed: the crescent follows McEwen (Lambert beyond ~102 deg, x 2/3), so 33 % below the old Lambert rendering', () => {
    for (const mu0 of [0.05, 0.3, 0.9]) expect(lunarLambert(mu0, 0.2, G10)).toBeCloseTo((2 / 3) * mu0, 12);
    const ratio = discStatistics(G10, { n: 160 }).litMean / discStatistics(G10, { model: lambert, n: 160 }).litMean;
    expect(ratio).toBeCloseTo(2 / 3, 2);
  });

  it('beyond the terminator it is black; grazing incidence / emission give no NaN', () => {
    for (const mu0 of [0, -0.2, -1]) expect(lunarLambert(mu0, 0.5, 60)).toBe(0);
    for (const [mu0, mu] of [[1e-12, 0], [1e-6, 0], [0.5, 0], [1e-9, 1e-9], [0.3, -0.4], [0.3, Number.NaN]]) {
      for (const g of [0, 45, 102, 170]) { const v = lunarLambert(mu0, mu, g); expect(Number.isFinite(v), `${mu0} ${mu} ${g}`).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(4 / 3); }
    }
  });

  it('the shader uses the same function (constants from moon-photometry.js, same guard) for the Sun and the earthshine', () => {
    expect(MOON_LUNAR_LAMBERT_GLSL).toContain('( -0.019 ) * g + ( 0.000242 ) * g * g + ( -0.00000146 ) * g * g * g, 0.0, 1.0 )');
    expect(MOON_LUNAR_LAMBERT_GLSL).toContain('return 0.66666667 * ( 2.0 * L * mu0 / max( mu0 + mu, 1e-4 ) + ( 1.0 - L ) * mu0 );');
    expect(MOON_LUNAR_LAMBERT_GLSL).toContain('if ( mu0 <= 0.0 ) return 0.0;');
    const frag = ['void main() {', MOON_LIGHTING_CHUNKS.begin, MOON_LIGHTING_CHUNKS.maps, MOON_LIGHTING_CHUNKS.end, 'vec3 outgoingLight = reflectedLight.directDiffuse;', MOON_LIGHTING_CHUNKS.output, '}'].join('\n');
    const shader = patchMoonLightingShader({ uniforms: {}, fragmentShader: frag }, {});
    expect(shader.fragmentShader.indexOf('float moonLunarLambert(')).toBeLessThan(shader.fragmentShader.indexOf('void main() {'));
    expect(shader.fragmentShader).toContain('vec3 moonViewDir = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );');
    expect(shader.fragmentShader).toContain('float moonEarthNL = moonLunarLambert( saturate( dot( normal, uMoonEarthDir ) ), moonMu, moonPhaseDeg( uMoonEarthDir, moonViewDir ) );');
    expect(shader.fragmentShader).not.toMatch(/saturate\( dot\( normal, uMoonSunDir \) \);\nreflectedLight/); // no plain Lambert left
  });

  it('declared in the Moon details: Reflectance row with the model, the clamp, the normalisation and the source', () => {
    const row = describeMoonReflectance();
    expect(row).toMatch(/^McEwen lunar-Lambert \(physical-model, approximated\)/);
    expect(row).toContain('USGS ISIS LunarLambertMcEwen (McEwen 1991, Icarus 92)');
    expect(row).toContain('clamped to [0, 1]');
    expect(row).toContain('scaled by 2/3');
    expect(text('src/earth/app-services.js')).toContain("{ label: 'Reflectance', value: describeMoonReflectance() }, // LOT 38");
  });
});

describe('LOT 38: Moon exposure auto (interpretive) / fixed', () => {
  it('auto: one EV from the phase, 0 at full Moon, increasing towards the crescent, capped at +3 EV', () => {
    expect(moonAutoExposureEv(0)).toBe(0);
    expect(moonAutoExposureEv(phaseAngleFromLitFraction(0.98))).toBeLessThan(0.25);
    expect(moonAutoExposureEv(90)).toBeCloseTo(1.05, 1);
    expect(moonAutoExposureEv(G10)).toBeCloseTo(2.45, 1);
    expect(moonAutoExposureEv(G5)).toBeGreaterThanOrEqual(2.85); expect(moonAutoExposureEv(G5)).toBeLessThanOrEqual(3);
    expect(moonAutoExposureEv(175)).toBe(MOON_AUTO_EV_MAX);
    expect(MOON_AUTO_EV_MAX).toBe(3);
    let prev = -1; for (let g = 0; g <= 180; g += 2) { const ev = moonAutoExposureEv(g); expect(ev).toBeGreaterThanOrEqual(prev); prev = ev; }
    expect(moonAutoExposureEv(Number.NaN)).toBe(0);
    expect(MOON_EXPOSURE_DEFAULT_MODE).toBe('auto');
  });

  it('auto: the 10 % crescent is visible (lit-part mean back near its full-Moon value); fixed: physics only', () => {
    const full = discStatistics(0).litMean; const ev = moonAutoExposureEv(G10);
    const crescentAuto = discStatistics(G10).litMean * 2 ** ev; const crescentFixed = discStatistics(G10).litMean;
    expect(crescentAuto / full).toBeGreaterThan(0.95);
    expect(crescentFixed / full).toBeLessThan(0.2);
    expect(crescentAuto / discStatistics(G10, { model: lambert }).litMean).toBeGreaterThan(3); // brighter than the old rendering
    expect(effectiveMoonExposureEv({ mode: 'fixed', autoEv: ev })).toBe(0);
    expect(effectiveMoonExposureEv({ mode: 'auto', autoEv: ev })).toBe(ev);
  });

  it('the EV shown is exactly the factor applied (uMoonExposure = 2^EV)', () => {
    for (const g of [0, 60, 90, G10, G5, 170]) {
      const ev = moonAutoExposureEv(g); const shown = describeMoonAutoExposure({ mode: 'auto', autoEv: ev });
      const parsed = Number(shown.match(/auto \+(\d+(?:\.\d+)?) EV/)[1]);
      expect(parsed).toBe(ev);
      expect(shown).toContain('(interpretive — as an eye or a photographer would expose for the crescent; max +3 EV)');
    }
    expect(describeMoonAutoExposure({ mode: 'fixed', autoEv: 2 })).toBe('Moon exposure: fixed +0 EV (physical photometry, no compensation)');
    const moon = text('src/earth/moon-system.js');
    expect(moon).toContain('state.effectiveExposureEv = effectiveMoonExposureEv({ mode: state.exposureMode, earthshineViewEv: state.exposureEv, autoEv: state.autoExposureEv });');
    expect(moon).toContain('moonLightUniforms.uMoonExposure.value = 2 ** state.effectiveExposureEv;');
  });

  it('the Earthshine view (+10 EV) applies over the fixed exposure, never over the auto one; clipping unchanged', () => {
    expect(effectiveMoonExposureEv({ mode: 'auto', earthshineViewEv: 10, autoEv: 2.45 })).toBe(10);
    expect(effectiveMoonExposureEv({ mode: 'fixed', earthshineViewEv: 10, autoEv: 2.45 })).toBe(10);
    expect(describeMoonExposure(10, null, { mode: 'auto', autoEv: 2.45 })).toBe('Moon exposure +10 EV (lit side clipped at sensor white, as in photographs); applied over the fixed exposure (the auto compensation is suspended)');
    expect(text('src/earth/moon-system.js')).toContain("if ( uMoonExposure > 1.0 ) outgoingLight = min( outgoingLight, vec3( uMoonSensorWhite ) );");
  });

  it('the live card row and the toolbar switch (default auto) are wired', () => {
    const rows = moonCardLiveRows({ phaseFraction: 0.1, exposureEv: 0, earthshineViewNote: null, cameraLitFraction: 0.1, exposureMode: 'auto', autoExposureEv: 2.45 }, describeMoonExposure);
    expect(rows.moonExposureValue).toMatch(/^Moon exposure: auto \+2\.45 EV \(interpretive/);
    expect(moonCardLiveRows({ phaseFraction: 0.1, exposureEv: 0, cameraLitFraction: 0.1, exposureMode: 'fixed', autoExposureEv: 2.45 }, describeMoonExposure).moonExposureValue).toMatch(/^Moon exposure: fixed \+0 EV/);
    expect(text('earth-eonet-relief.html')).toContain('<button id="moonExposureModeBtn" type="button" aria-pressed="true" class="toolbar-span"');
    expect(text('earth-eonet-relief.html')).toContain('>Moon exposure: auto</button>');
    expect(text('src/earth/control-panel.js')).toContain("byId('moonExposureModeBtn')?.addEventListener('click', () => { // LOT 38");
    expect(text('src/earth/app-runtime.js')).toContain('moonSystem?.toggleMoonExposureMode?.();');
    expect(text('src/earth/moon-system.js')).toMatch(/exposureMode: MOON_EXPOSURE_DEFAULT_MODE,/);
  });
});

describe('LOT 38 PAS 2: the earthshine colour (Thejll et al. 2014, observed; RGB approximated)', async () => {
  const { EARTHSHINE_COLOUR, earthshineTint } = await import('../src/earth/earthshine.js');
  const { describeMoonIllumination } = await import('../src/earth/scene-lighting.js');
  it('the measured difference: the earthlit side is 0.150 +/- 0.005 mag bluer in B-V than the sunlit side', () => {
    expect(EARTHSHINE_COLOUR).toMatchObject({ deltaBV: -0.150, deltaBVUncertainty: 0.005, earthlightBV: 0.44, source: 'Thejll et al. 2014, A&A 563, A38 (arXiv:1401.1994)' });
  });
  it('the tilt reproduces F_B / F_V = 10^(0.4 x 0.150) between the B and V bands, keeps the luminance and is bluer (B > G > R)', () => {
    const k = Math.log(10 ** 0.06) / Math.log(0.55 / 0.44);
    const t = (um) => (um / 0.55) ** -k;
    expect(t(0.44) / t(0.55)).toBeCloseTo(10 ** (0.4 * 0.150), 10);
    const [r, g, b] = earthshineTint();
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 12); // the earthshine ratio (illuminance) is unchanged
    expect(b).toBeGreaterThan(g); expect(g).toBeGreaterThan(r);
    expect([r, g, b].map((v) => +v.toFixed(3))).toEqual([0.941, 1.006, 1.116]);
    expect(earthshineTint({ deltaBV: 0 })).toEqual([1, 1, 1]); // no measured difference -> the sunlight colour
  });
  it('the shader multiplies only the earthshine term by the tint; the uniform comes from earthshineTint()', () => {
    const frag = ['void main() {', MOON_LIGHTING_CHUNKS.begin, MOON_LIGHTING_CHUNKS.maps, MOON_LIGHTING_CHUNKS.end, 'vec3 outgoingLight = reflectedLight.directDiffuse;', MOON_LIGHTING_CHUNKS.output, '}'].join('\n');
    const f = patchMoonLightingShader({ uniforms: {}, fragmentShader: frag }, {}).fragmentShader;
    expect(f).toContain('uniform vec3 uMoonEarthshineTint;');
    expect(f).toContain('reflectedLight.directDiffuse += moonSunNL * uMoonSunColor * BRDF_Lambert( material.diffuseColor );');
    expect(f.match(/uMoonEarthshineTint \*/g)).toHaveLength(1);
    expect(text('src/earth/moon-system.js')).toContain('uMoonEarthshineTint: { value: new THREE.Vector3(...earthshineTint()) },');
  });
  it('declared in "Illumination": observed difference, source, RGB factors, approximated', () => {
    const light = { color: { getHexString: () => 'ffe6c9' }, intensity: 2.55 };
    const v = describeMoonIllumination({ sunLight: light, earthshine: { ratio: 1e-4, stops: 13.3, earthPhaseAngleDeg: 26, albedo: 0.434 } });
    expect(v).toContain('colour: bluer than the sunlight by Δ(B−V) = -0.150 ± 0.005 mag on the Moon (observed, Thejll et al. 2014, A&A 563, A38 (arXiv:1401.1994)), applied as linear RGB × 0.941 / 1.006 / 1.116 (approximated, luminance kept)');
  });
});
