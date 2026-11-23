// LOT 33c: the open "The Moon" card follows the Earthshine view (on / off), the phase and the camera; and on the
// mobile layout, hidden panels no longer take the taps meant for the globe / the Moon.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describePhaseFromEarth, moonCardLiveRows } from '../src/earth/moon-viewpoint.js';
import { describeMoonExposure } from '../src/earth/scene-lighting.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = text('earth-eonet-relief.html');

describe('LOT 33c fix 1: the Moon card rows are live', () => {
  const base = { phaseFraction: 0.1056, earthshineViewNote: null, cameraLitFraction: 0.1056 };
  it('Earthshine view on: the Exposure row says +10 EV (it said "Normal exposure (+0 EV)" in capture desktop-b)', () => {
    const rows = moonCardLiveRows({ ...base, exposureEv: 10 }, describeMoonExposure);
    expect(rows.moonExposureValue).toBe('Moon exposure +10 EV (lit side clipped at sensor white, as in photographs)');
    expect(rows.moonPhaseValue).toBe('11% lit from Earth');
    expect(rows.moonCameraViewValue).toBe('11 % of the disc sunlit');
  });
  it('off: the normal-exposure text; with the turn-off note when the phase switched it off', () => {
    expect(moonCardLiveRows({ ...base, exposureEv: 0 }, describeMoonExposure).moonExposureValue).toMatch(/^Normal exposure \(\+0 EV\)/);
    const note = 'Earthshine view turned off: Earthshine too faint at this phase — 41 % lit';
    expect(moonCardLiveRows({ ...base, exposureEv: 0, earthshineViewNote: note }, describeMoonExposure).moonExposureValue).toContain(note);
    expect(describePhaseFromEarth(null)).toBe('unknown');
  });
  it('wiring: the card renders spans with these ids; every exposure / phase change and every camera-% change refreshes them', () => {
    const services = text('src/earth/app-services.js');
    for (const id of ['moonPhaseValue', 'moonExposureValue', 'moonCameraViewValue']) expect(services).toContain(`id: '${id}'`);
    const moon = text('src/earth/moon-system.js');
    const button = moon.slice(moon.indexOf('function updateEarthshineViewButton()'), moon.indexOf('function refreshMoonCard()'));
    expect(button).toContain('refreshMoonCard(); // LOT 33c'); // setMoonExposureEv, toggle, the phase threshold and updateMoonPosition all pass here
    expect(moon).toMatch(/function setMoonExposureEv\(ev = 0\) \{[\s\S]*?updateEarthshineViewButton\(\);/);
    expect(moon).toMatch(/function refreshMoonCard\(\) \{[\s\S]*?const rows = moonCardLiveRows\(state, describeMoonExposure\);[\s\S]*?if \(cell && cell\.textContent !== value\) cell\.textContent = value;/);
    expect(moon).toContain('if (pct !== shownCameraPct) { shownCameraPct = pct; refreshMoonCard(); }');
  });
});
