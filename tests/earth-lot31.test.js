// LOT 31 — scene lighting declared as it is (PAS 1); ETAPA 2: the Moon is lit only by the real Sun and a
// physical earthshine; the Earth keeps its declared artistic fill.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeArtisticFill, describeMoonIllumination, describeSun } from '../src/earth/scene-lighting.js';
import { EARTH_GEOMETRIC_ALBEDO, earthPhaseAngleFromElongationCos, earthshineRatio, formatRatio, lambertPhase, stopsBelowSun } from '../src/earth/earthshine.js';
import { MOON_LIGHTING_CHUNKS, patchMoonLightingShader } from '../src/earth/moon-system.js';
import { earthLookPresets } from '../src/earth/earth-look.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const light = (hex, intensity) => ({ color: { getHexString: () => hex }, intensity });

describe('LOT 31: Moon and Earth lighting, declared', () => {
  it('Earth artistic fill is described from the live lights (cool light opposite the Sun + ambient)', () => {
    expect(describeSun(light('ffe6c9', 2.55))).toBe('Sun: real direction (physical-model, Astronomy Engine) · directional #ffe6c9 × 2.55');
    expect(describeArtisticFill({ coolFill: light('66d0ff', 0.28), ambientLight: light('182336', 0.34), look: 'cinematic' }))
      .toEqual(['cool directional light opposite the Sun #66d0ff × 0.28 (look: cinematic)', 'ambient #182336 × 0.34']);
  });

  it('ETAPA 2: Moon "Illumination" = Sun + physical earthshine (value, stops), no fill', () => {
    const value = describeMoonIllumination({ sunLight: light('ffe6c9', 2.55), earthshine: { ratio: 1.0107e-4, stops: 13.27, earthPhaseAngleDeg: 26.06, albedo: 0.434 } });
    expect(value).toBe("Sun: real direction (physical-model, Astronomy Engine) · directional #ffe6c9 × 2.55 · earthshine (physical-model, approximated: p = 0.434 geometric albedo, Lambert phase, from the Earth's direction): Earth phase angle 26°, 1.0×10⁻⁴ of the sunlight (13.3 stops below) — no artistic fill on the Moon");
    expect(describeMoonIllumination({ sunLight: light('ffe6c9', 2.55), earthshine: { ratio: 0, stops: Infinity, earthPhaseAngleDeg: 180, albedo: 0.434 } }))
      .toMatch(/Earth phase angle 180°, 0 \(new Earth\) — no artistic fill on the Moon$/);
    const services = text('src/earth/app-services.js');
    expect(services).toContain("{ label: 'Illumination', value: describeMoonIllumination({ sunLight: bootstrap.sunLight, earthshine: m.earthshine }) },");
    expect(services).not.toContain('same sunLight as Earth');
  });

  it('the Earth credits line matches the lights in the code; the Moon gets no fill', () => {
    const line = text('earth-eonet-relief.html').match(/<li>Lighting: [^<]+<\/li>/)[0];
    expect(text('src/earth/solar-system.js')).toContain('new THREE.DirectionalLight(0x66d0ff, 0.28)');
    expect(text('src/earth/earth-app-bootstrap.js')).toContain('new THREE.AmbientLight(0x182336, 0.34)');
    expect([earthLookPresets.scientific, earthLookPresets.cinematic, earthLookPresets.showcase].map((p) => p.coolFillIntensity)).toEqual([0.1, 0.28, 0.46]);
    for (const part of ['#66d0ff, 0.10 / 0.28 / 0.46 by Earth look', '#182336 × 0.34', 'The Moon gets no fill', 'Earth geometric albedo 0.434, NASA Earth Fact Sheet', 'Lambert phase function, an approximation', '(interpretive)', '(physical model)']) {
      expect(line).toContain(part);
    }
    expect(text('src/earth/moon-system.js')).not.toMatch(/emissive:|emissiveIntensity/);
  });

  it('no text claims physical lighting or earthshine light that the scene does not have', () => {
    const all = ['src/earth/app-services.js', 'src/earth/caption-system.js', 'src/config/observatory-registry.js', 'src/config/source-registry.js', 'index.html', 'earth-eonet-relief.html', 'living-himalaya.html', 'src/himalaya/himalaya-app.js'].map(text).join('\n');
    for (const claim of [/THE DARK SIDE LIT BY EARTH/, /physically bounded/, /physical solar lighting/, /'Moon & Earthshine'/, /Earthshine geometry/, /libration and Earthshine</, /lit by the real Sun under the real sky/, /uniform albedo lit by the computed Sun ·/, /Terrain is lit by the Sun for the selected time;/]) {
      expect(all).not.toMatch(claim);
    }
    expect(text('src/himalaya/himalaya-scene.js')).toContain('new THREE.HemisphereLight(0x9cc7ff, 0x1a1c22, 0.32)');
    expect(text('living-himalaya.html')).toContain('Lit terrain: uniform albedo lit by the computed Sun and a dim sky fill (hemisphere light, interpretive)');
  });
});

describe('LOT 31 ETAPA 2: physical earthshine', () => {
  const d = 384400;
  // Earth phase angle seen from the Moon from the Moon's lit fraction k (k = (1 - cos(elongation)) / 2).
  const alphaFromMoonFraction = (k) => earthPhaseAngleFromElongationCos(1 - 2 * k);

  it('formula: full Earth ~1.2e-4, quarter ~3.8e-5, gibbous 90 % ~3.3e-6, full Moon -> 0', () => {
    expect(EARTH_GEOMETRIC_ALBEDO).toBe(0.434);
    expect(earthshineRatio({ earthPhaseAngle: 0, distanceKm: d })).toBeCloseTo(1.19e-4, 6);
    expect(earthshineRatio({ earthPhaseAngle: Math.PI / 2, distanceKm: d })).toBeCloseTo(3.8e-5, 6);
    expect(earthshineRatio({ earthPhaseAngle: alphaFromMoonFraction(0.9), distanceKm: d })).toBeCloseTo(3.24e-6, 7);
    expect(earthshineRatio({ earthPhaseAngle: Math.PI, distanceKm: d })).toBe(0);
    expect(earthshineRatio({ earthPhaseAngle: alphaFromMoonFraction(1), distanceKm: d })).toBeLessThan(1e-12);
  });

  it('phase function: 1 at 0, 1/pi at 90 deg, 0 at pi; monotonic; clamped; no NaN', () => {
    expect(lambertPhase(0)).toBe(1);
    expect(lambertPhase(Math.PI / 2)).toBeCloseTo(1 / Math.PI, 12);
    expect(lambertPhase(Math.PI)).toBe(0);
    let prev = 2;
    for (let i = 0; i <= 180; i++) {
      const v = lambertPhase((i * Math.PI) / 180);
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
    expect(lambertPhase(-1)).toBe(1);
    expect(lambertPhase(4)).toBe(0);
    expect(lambertPhase(NaN)).toBe(0);
    expect(earthPhaseAngleFromElongationCos(1.0000001)).toBe(0);
    expect(earthPhaseAngleFromElongationCos(-1.2)).toBe(Math.PI);
    expect(earthPhaseAngleFromElongationCos(NaN)).toBe(0);
  });

  it('waxing and waning give the same value; inverse square in distance; invalid inputs give 0', () => {
    const waxing = earthPhaseAngleFromElongationCos(Math.cos(1.1));
    const waning = earthPhaseAngleFromElongationCos(Math.cos(-1.1));
    expect(earthshineRatio({ earthPhaseAngle: waxing, distanceKm: d })).toBe(earthshineRatio({ earthPhaseAngle: waning, distanceKm: d }));
    expect(earthshineRatio({ earthPhaseAngle: 0, distanceKm: 2 * d }) * 4).toBeCloseTo(earthshineRatio({ earthPhaseAngle: 0, distanceKm: d }), 12);
    for (const bad of [0, -1, NaN, 6000]) expect(earthshineRatio({ earthPhaseAngle: 0, distanceKm: bad })).toBe(0);
    expect(stopsBelowSun(1.19e-4)).toBeCloseTo(13.04, 2);
    expect(stopsBelowSun(0)).toBe(Infinity);
    expect(formatRatio(1.0107e-4)).toBe('1.0×10⁻⁴');
    expect(formatRatio(3.8e-5)).toBe('3.8×10⁻⁵');
    expect(formatRatio(0)).toBe('0');
  });

  it('Moon material: only the light accumulation is replaced (Sun + earthshine), exposure before output; fails loudly if three.js changes', () => {
    const frag = ['void main() {', '#include <lights_lambert_fragment>', MOON_LIGHTING_CHUNKS.begin, MOON_LIGHTING_CHUNKS.maps, MOON_LIGHTING_CHUNKS.end, 'vec3 outgoingLight = reflectedLight.directDiffuse;', MOON_LIGHTING_CHUNKS.output, '}'].join('\n');
    const shader = { uniforms: {}, fragmentShader: frag };
    patchMoonLightingShader(shader, { uMoonExposure: { value: 1 } });
    expect(shader.uniforms.uMoonExposure.value).toBe(1);
    for (const gone of ['lights_fragment_begin', 'lights_fragment_maps', 'lights_fragment_end']) expect(shader.fragmentShader).not.toContain(gone);
    expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse += moonSunNL * uMoonSunColor * BRDF_Lambert( material.diffuseColor );');
    expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse += moonEarthNL * uMoonEarthshine * uMoonSunColor * BRDF_Lambert( material.diffuseColor );');
    expect(shader.fragmentShader).toMatch(/outgoingLight \*= uMoonExposure;\n#include <opaque_fragment>/);
    expect(shader.fragmentShader).toMatch(/uniform vec3 uMoonSunDir;[\s\S]*void main\(\) \{/);
    expect(() => patchMoonLightingShader({ uniforms: {}, fragmentShader: 'void main() {}' }, {})).toThrow(/chunk not found/);
  });
});

describe('LOT 31 ETAPA 2 PAS 2: Earthshine view (+10 EV on the whole Moon), halo removed', async () => {
  const { describeMoonExposure } = await import('../src/earth/scene-lighting.js');
  it('the earthshine halo and its boost are gone from code, captions and pages', () => {
    const moon = text('src/earth/moon-system.js');
    for (const gone of ['moonEarthshine', 'createEarthshineTexture', 'setEarthshineBoost', 'earthshineBoost']) expect(moon).not.toContain(gone);
    const all = ['src/earth/reel-timeline.js', 'src/earth/reel-overlay.js', 'src/earth/caption-system.js', 'src/earth/app-services.js', 'src/earth/scene-lighting.js', 'index.html', 'earth-eonet-relief.html', 'src/config/observatory-registry.js', 'src/config/source-registry.js'].map(text).join('\n');
    expect(all).not.toMatch(/setEarthshineBoost|earthshine halo|EARTHSHINE_HALO|DECORATIVE HALO/i);
  });
  it('one exposure for the whole Moon material, declared on the button and in the details; the Earth is not touched', () => {
    const moon = text('src/earth/moon-system.js');
    expect(moon).toContain('moonLightUniforms.uMoonExposure.value = 2 ** state.exposureEv;');
    expect(moon).toContain('const EARTHSHINE_VIEW_EV = 10;');
    expect(describeMoonExposure(10)).toBe('Moon exposure +10 EV (lit side clipped, as in photographs)');
    expect(describeMoonExposure(0)).toMatch(/^Normal exposure \(\+0 EV\)/);
    expect(text('src/earth/app-services.js')).toContain("{ label: 'Exposure', value: describeMoonExposure(m.exposureEv) },");
    expect(text('earth-eonet-relief.html')).toContain('<button id="earthshineViewBtn" aria-pressed="false"');
    expect(text('src/earth/control-panel.js')).toContain("byId('earthshineViewBtn')?.addEventListener('click', () => {");
    // Only the Moon material reads uMoonExposure.
    for (const f of ['src/earth/earth-material.js', 'src/earth/earth-layers.js', 'src/earth/cloud-shaders.js']) expect(text(f), f).not.toContain('uMoonExposure');
  });
  it('the reel uses the same mechanism and says so', () => {
    const reel = text('src/earth/reel-timeline.js');
    expect(reel).toContain('moonSystem.setMoonExposureEv?.(10);');
    expect(reel.match(/setMoonExposureEv\?\.\(0\)/g)).toHaveLength(2);
    expect(text('src/earth/caption-system.js')).toContain("subtitle: 'MOON EXPOSURE +10 EV, LIT SIDE CLIPPED',");
  });
});
