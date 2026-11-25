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

  it('the Earthshine view applies over the fixed exposure, never over the auto one; clipping unchanged', () => {
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

describe('LOT 38 PAS 3: the Moon after the bloom, only in the Earthshine view', async () => {
  const { AFTER_BLOOM_LAYER, createAfterBloom } = await import('../src/earth/after-bloom.js');
  class FakePass { constructor() { this.enabled = true; this.needsSwap = true; this.renderToScreen = false; } }
  const layers = () => ({ mask: 1, enable(l) { this.mask |= 1 << l; }, disable(l) { this.mask &= ~(1 << l); }, set(l) { this.mask = 1 << l; } });
  const node = (children = []) => { const o = { visible: true, layers: layers(), children, traverse(fn) { fn(o); for (const c of children) c.traverse(fn); } }; return o; };
  const setup = () => {
    const ab = createAfterBloom(); const camera = { layers: layers() }; const scene = { id: 'scene' };
    const calls = []; const renderer = { autoClear: true, setRenderTarget(t) { calls.push(['target', t]); }, render(s, c) { calls.push(['render', s, c.layers.mask, this.autoClear]); } };
    const { hide, after } = ab.createPasses({ Pass: FakePass, scene, camera });
    return { ab, camera, scene, renderer, calls, hide, after };
  };
  it('disabled while there is no target (the composer skips them: default rendering unchanged); no swap', () => {
    const { hide, after } = setup();
    expect([hide.enabled, after.enabled, hide.needsSwap, after.needsSwap]).toEqual([false, false, false, false]);
    expect(AFTER_BLOOM_LAYER).toBe(5);
  });
  it('active: hidden for the RenderPass + bloom, then drawn alone (its layer only) into the same buffer, no clear; state restored', () => {
    const { ab, camera, scene, renderer, calls, hide, after } = setup();
    const marker = node(); const moon = node([marker]);
    ab.setTarget(moon);
    expect([hide.enabled, after.enabled]).toEqual([true, true]);
    hide.render(renderer);
    expect(moon.visible).toBe(false);
    const readBuffer = { id: 'read' };
    after.render(renderer, { id: 'write' }, readBuffer);
    expect(moon.visible).toBe(true);
    expect(calls).toEqual([['target', readBuffer], ['render', scene, 1 << 5, false]]);
    expect(camera.layers.mask).toBe(1); expect(renderer.autoClear).toBe(true);
    expect(moon.layers.mask).toBe(1 | (1 << 5)); expect(marker.layers.mask).toBe(1 | (1 << 5)); // markers drawn with the Moon; still on layer 0
    ab.setTarget(null);
    expect([hide.enabled, after.enabled, moon.layers.mask, marker.layers.mask]).toEqual([false, false, 1, 1]);
  });
  it('an occluded Moon (invisible before the frame) stays invisible and is not drawn', () => {
    const { ab, renderer, calls, hide, after } = setup();
    const moon = node(); moon.visible = false; ab.setTarget(moon);
    hide.render(renderer); after.render(renderer, {}, {});
    expect(moon.visible).toBe(false); expect(calls).toEqual([]);
  });
  it('wiring: hide before the RenderPass, draw right after the bloom (live view and export); only the Earthshine view sets the target; stop() releases it', () => {
    const rt = text('src/earth/scene-runtime.js');
    expect(rt).toMatch(/composer\.addPass\(new RenderPass\(scene, camera\)\);[\s\S]*composer\.insertPass\(afterBloomPasses\.hide, 0\);[\s\S]*composer\.addPass\(bloomPass\);\n    composer\.addPass\(afterBloomPasses\.after\); \/\/ LOT 38 PAS 3\n    const smaaPass/);
    const ex = text('src/earth/export-system.js');
    expect(ex).toContain('exportComposer.addPass(exportBloom);\n        const exportAfterBloom = afterBloom ? afterBloom.createPasses({ Pass, scene, camera: exportCamera }) : null;');
    expect(ex).toContain('if (exportAfterBloom) { exportComposer.insertPass(exportAfterBloom.hide, 0); exportComposer.addPass(exportAfterBloom.after); }');
    expect(ex).toContain('if (exportAfterBloom) afterBloom.removePasses(exportAfterBloom);');
    const moon = text('src/earth/moon-system.js');
    expect(moon).toContain('state.afterBloom = Boolean(afterBloom) && state.exposureEv > 0;');
    expect(moon).toContain('afterBloom?.setTarget(state.afterBloom ? moon : null);');
    expect(moon).toContain('if (afterBloom?.target === moon) afterBloom.setTarget(null);');
  });
});

describe('LOT 38 (approval): Earthshine view +11 EV, threshold kept at 40 % lit', async () => {
  const es = await import('../src/earth/earthshine.js');
  const { EARTHSHINE_NOTE_AVAILABLE } = await import('../src/earth/earthshine-window.js');
  const stopsAt = (k, d = 384400) => es.stopsBelowSun(es.earthshineRatio({ earthPhaseAngle: Math.acos(1 - 2 * k), distanceKm: d }));
  it('+11 EV, threshold 40 %; the requested value is clamped to it; one value everywhere (button, note, caption, reel, details)', () => {
    expect([es.EARTHSHINE_VIEW_EV, es.EARTHSHINE_VIEW_MAX_LIT_FRACTION]).toEqual([11, 0.4]);
    expect(es.requestEarthshineExposure({ wantedEv: 99, litFraction: 0.1, stops: 13.3 })).toEqual({ ev: 11, applied: true, note: null });
    expect(es.requestEarthshineExposure({ wantedEv: 11, litFraction: 0.41, stops: 14.4 }).applied).toBe(false);
    expect(es.EARTHSHINE_VIEW_TITLE).toMatch(/^Moon exposure \+11 EV on the whole Moon: .*\(drawn after the bloom: no glow\)\. Available up to 40 % lit\./);
    expect(EARTHSHINE_NOTE_AVAILABLE).toBe('Moon exposure +11 EV — lit side clipped, as in photographs.');
    expect(describeMoonExposure(0)).toMatch(/use Earthshine view \(\+11 EV\) up to 40 % lit$/);
    expect(text('earth-eonet-relief.html')).toContain('title="Moon exposure +11 EV on the whole Moon:');
    expect(text('earth-eonet-relief.html')).toContain('Earthshine view raises the Moon exposure by 11 EV');
    expect(text('src/earth/reel-overlay.js')).toContain("'moonSystem.setMoonExposureEv(11); // earthshine view',");
    for (const f of ['src/earth/earthshine.js', 'src/earth/earthshine-window.js', 'src/earth/caption-system.js', 'src/earth/reel-timeline.js', 'src/earth/scene-lighting.js', 'earth-eonet-relief.html']) {
      expect(text(f).replace(/it was 1\/19 at \+10 EV/, ''), f).not.toMatch(/\+10 EV|setMoonExposureEv\?\.\(10\)|by 10 EV/);
    }
  });
  it('stops below sensor white = stops - EV; at +11 the earthshine side of a 10 % crescent sits ~2.3 stops below (it was ~3.3 at +10)', () => {
    expect(es.earthshineStopsBelowSensorWhite({ stops: 13.31 })).toBeCloseTo(2.31, 2);
    expect(es.earthshineStopsBelowSensorWhite({ stops: 13.31, ev: 10 })).toBeCloseTo(3.31, 2);
    expect(es.earthshineStopsBelowSensorWhite({ stops: Infinity })).toBe(Infinity);
    expect(describeMoonExposure(11, null, { mode: 'auto', autoEv: 2.4, stops: 13.31 })).toBe('Moon exposure +11 EV (lit side clipped at sensor white, as in photographs); applied over the fixed exposure (the auto compensation is suspended); earthshine side 2.3 stops below sensor white');
    expect(moonCardLiveRows({ phaseFraction: 0.1, exposureEv: 11, cameraLitFraction: 0.1, exposureMode: 'fixed', autoExposureEv: 0, earthshine: { stops: 13.31 } }, describeMoonExposure).moonExposureValue).toMatch(/earthshine side 2\.3 stops below sensor white$/);
  });
  it('the threshold: at 40 % lit the earthshine side is 1/9.6 of the normally exposed sunlit surface at +11 EV (1/19 at +10); the LOT 31 criterion would have moved it to ~61 %', () => {
    expect(2 ** (stopsAt(0.4) - 11)).toBeCloseTo(9.6, 0);
    expect(2 ** (stopsAt(0.4) - 10)).toBeCloseTo(19.3, 0);
    expect(2 ** (stopsAt(0.6143) - 11)).toBeCloseTo(2 ** (stopsAt(0.4) - 10), 1);
  });
});
