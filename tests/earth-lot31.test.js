// LOT 31 PAS 1 — the scene lighting is declared as it is: the real Sun (physical model) plus an artistic
// fill (interpretive); earthshine is not modelled as light, the "earthshine" billboard is a decorative halo.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EARTHSHINE_HALO_LABEL, EARTHSHINE_NOT_MODELLED, describeArtisticFill, describeMoonIllumination, describeSun } from '../src/earth/scene-lighting.js';
import { earthLookPresets } from '../src/earth/earth-look.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const light = (hex, intensity) => ({ color: { getHexString: () => hex }, intensity });

describe('LOT 31: Moon and Earth lighting, declared', () => {
  it('Moon "Illumination": the Sun + every artistic contribution by name, colour, intensity and active look', () => {
    const value = describeMoonIllumination({
      sunLight: light('ffe6c9', 2.55), coolFill: light('66d0ff', 0.28), ambientLight: light('182336', 0.34),
      moonMaterial: { emissive: { getHexString: () => '10263a' }, emissiveIntensity: 0.18 }, look: 'cinematic',
    });
    expect(value).toBe('Sun: real direction (physical-model, Astronomy Engine) · directional #ffe6c9 × 2.55 · plus artistic fill (interpretive): cool directional light opposite the Sun #66d0ff × 0.28 (look: cinematic), ambient #182336 × 0.34, emissive tint #10263a × 0.18 — earthshine not modelled as light');
    expect(describeSun(light('ffe6c9', 2.55))).toMatch(/^Sun: real direction \(physical-model/);
    expect(describeArtisticFill({ coolFill: light('66d0ff', 0.1), look: 'scientific' })).toEqual(['cool directional light opposite the Sun #66d0ff × 0.1 (look: scientific)']);
  });

  it('the Moon details card uses the live lights and adds the halo row; the old sentence is gone', () => {
    const services = text('src/earth/app-services.js');
    expect(services).toContain("{ label: 'Illumination', value: describeMoonIllumination({ sunLight: bootstrap.sunLight, coolFill, ambientLight: bootstrap.ambientLight, moonMaterial: moonSystem.moon.material, look: state.earthLook }) },");
    expect(services).toContain("{ label: 'Earthshine', value: EARTHSHINE_HALO_LABEL },");
    expect(services).not.toContain('same sunLight as Earth');
    expect(EARTHSHINE_HALO_LABEL).toMatch(/^Decorative additive halo .*interpretive.*does not light the surface$/);
    expect(EARTHSHINE_NOT_MODELLED).toBe('earthshine not modelled as light');
  });

  it('the Earth credits line matches the lights in the code (colours, intensities by look)', () => {
    const html = text('earth-eonet-relief.html');
    const line = html.match(/<li>Lighting: [^<]+<\/li>/)[0];
    expect(text('src/earth/solar-system.js')).toContain('new THREE.DirectionalLight(0x66d0ff, 0.28)');
    expect(text('src/earth/earth-app-bootstrap.js')).toContain('new THREE.AmbientLight(0x182336, 0.34)');
    expect(text('src/earth/moon-system.js')).toMatch(/emissive: 0x10263a,\s*\n\s*emissiveIntensity: 0\.18,/);
    expect([earthLookPresets.scientific, earthLookPresets.cinematic, earthLookPresets.showcase].map((p) => p.coolFillIntensity)).toEqual([0.1, 0.28, 0.46]);
    for (const part of ['#66d0ff, 0.10 / 0.28 / 0.46 by Earth look', '#182336 × 0.34', '#10263a × 0.18', 'Earthshine is not modelled as light', '(interpretive)', '(physical model)']) expect(line).toContain(part);
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
