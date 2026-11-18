// LOT 18 — contrast: route lines as casing + core, the free text over the new sky,
// E_max final, and the camera-colour note on the sky sources.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTE_COLOR, ROUTE_LINE } from '../src/himalaya/routes-model.js';
import { SKY_MODEL } from '../src/core/sky/sky-atmosphere.js';
import { BRIGHT_SKY_DISPLAY, isBrightSky, skyAttribution } from '../src/himalaya/himalaya-sky.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const CAMERA = 'colours as recorded by a camera; the dark-adapted eye sees little colour';

/** sRGB hex -> CIELAB (D65). */
function lab(hex) {
  const lin = [16, 8, 0].map((s) => { const c = ((hex >> s) & 255) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const X = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047;
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const Z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

describe('LOT 18: route lines = dark casing under an orange core', () => {
  it('widths, colours, opacity and order: casing ~5 px dark at 0.75 drawn under a 2.5 px saturated orange core', () => {
    expect(ROUTE_LINE.casing).toMatchObject({ color: 0x1a1410, widthPx: 5, opacity: 0.75, dashed: false });
    expect(ROUTE_LINE.core).toMatchObject({ color: 0xff8a3d, widthPx: 2.5, opacity: 1 });
    expect(ROUTE_LINE.casing.widthPx).toBeGreaterThan(ROUTE_LINE.core.widthPx);
    expect(ROUTE_LINE.casing.renderOrder).toBeLessThan(ROUTE_LINE.core.renderOrder); // casing first (both transparent)
    const scene = text('src/himalaya/himalaya-scene.js');
    expect(scene).toContain("for (const part of ['casing', 'core']) {");
    expect(scene).toContain("const dashed = part === 'core' ? route.style === 'dashed' : spec.dashed;");
    expect(scene).toContain("depthWrite: part === 'core'"); // the casing never hides the core
    expect(scene).toContain('line.renderOrder = spec.renderOrder;');
    expect(scene).toContain('const campMaterial = track(new THREE.MeshBasicMaterial({ color: ROUTE_COLOR,'); // camps unchanged
    expect(ROUTE_COLOR).toBe(0xe8d9b0);
  });

  it('the core colour is not confused with the summit cyan, selected lavender, active amber or the ⚠ gold', () => {
    const others = { cyan: 0x67e8f9, lavender: 0xc4b5fd, amber: 0xfde68a, flag: 0xf5c97a, campLabel: 0xe8d9b0 };
    for (const [name, hex] of Object.entries(others)) expect(deltaE(ROUTE_LINE.core.color, hex), name).toBeGreaterThan(30);
    // and stands out from both sunlit snow and the dark casing
    expect(deltaE(ROUTE_LINE.core.color, 0xf4f6f8)).toBeGreaterThan(50);
    expect(deltaE(ROUTE_LINE.core.color, ROUTE_LINE.casing.color)).toBeGreaterThan(60);
  });
});

describe('LOT 18: free text over the sky', () => {
  it('a veil behind the title block, stronger over a bright displayed sky; Return and longitude labels too', () => {
    const css = text('styles/himalaya.css');
    expect(css).toMatch(/\.himalaya-brand \{ --sky-veil: 0\.42;[^}]*background: rgba\(3, 8, 16, var\(--sky-veil\)\)/);
    expect(css).toContain('body.is-bright-sky .himalaya-brand { --sky-veil: 0.78; }');
    expect(css).toContain('body.is-bright-sky .himalaya-return { background: rgba(4, 9, 17, 0.82); }');
    expect(css).toMatch(/\.himalaya-grid-label \{[^}]*text-shadow:/);
    expect(text('src/himalaya/himalaya-app.js')).toContain("document.body.classList.toggle('is-bright-sky', isBrightSky(");
  });

  it('bright sky = tone-mapped reference sky above the threshold (day and twilight yes, dark night no)', () => {
    const snap = (exposure, referenceCdm2) => ({ backgroundVisible: true, exposure, referenceCdm2 });
    expect(BRIGHT_SKY_DISPLAY).toBe(0.03);
    expect(isBrightSky(snap(1.57e-6, 1.14e5))).toBe(true); // Sun +30 deg
    expect(isBrightSky(snap(50, 1.9e-3))).toBe(true); // Sun -12 deg
    expect(isBrightSky(snap(50, 3.09e-4))).toBe(false); // dark night
    expect(isBrightSky({ backgroundVisible: false, exposure: 1, referenceCdm2: 1 })).toBe(false); // no sky drawn
    expect(isBrightSky(null)).toBe(false);
  });
});

describe('LOT 18: E_max final and the sky notes', () => {
  it('E_max = 50, no provisional marker, declared as an aesthetic choice', () => {
    expect(SKY_MODEL.exposure.eMax).toBe(50);
    expect('eMaxProvisional' in SKY_MODEL.exposure).toBe(false);
    const note = skyAttribution({ k: 0.0747 }).note;
    expect(note).toContain('display target 0.18, adaptation limit E_max = 50 — aesthetic choice');
    expect(note).not.toMatch(/provisional/i);
    expect(SOURCE_DEFINITIONS.himalayaSkyNight.process).toContain('display target 0.18, adaptation limit E_max = 50 per cd/m^2 — aesthetic choice');
    expect(JSON.stringify(SOURCE_DEFINITIONS.himalayaSkyNight)).not.toMatch(/provisional/i);
  });

  it('camera colours: Himalaya sky note and registry, Living Earth registry (text only)', () => {
    expect(skyAttribution(null).note).toContain(CAMERA);
    expect(SOURCE_DEFINITIONS.himalayaSkyNight.provenanceNote).toContain(CAMERA);
    expect(SOURCE_DEFINITIONS.realSky.provenanceNote).toContain(CAMERA);
  });
});
