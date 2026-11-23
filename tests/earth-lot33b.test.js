// LOT 33b: the Moon as the camera sees it (apart from the phase seen from the Earth) and "View from Earth".
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMERA_VIEW_HINT, EARTH_VIEW_FILL, cameraLitFraction, cameraViewHint, describeCameraView, earthViewCameraPosition, earthViewDistance } from '../src/earth/moon-viewpoint.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = text('earth-eonet-relief.html');

// Geometry: Earth at the origin, Moon on +x at 13.5 (scene units), Sun at elongation E from the Moon (seen from Earth).
const MOON = [13.5, 0, 0];
const sunAt = (elongDeg) => { const e = (elongDeg * Math.PI) / 180; return [Math.cos(e), Math.sin(e), 0]; };
const geocentricPhase = (elongDeg) => (1 - Math.cos((elongDeg * Math.PI) / 180)) / 2; // moon-system.js phaseFraction

describe('LOT 33b: sunlit fraction seen by the camera', () => {
  for (const e of [36.87, 90, 150, 180]) { // 10 %, 50 %, 93 %, 100 % lit from Earth
    it(`elongation ${e}°: camera at the Earth = the phase seen from Earth; camera beyond the Moon = 1 - phase`, () => {
      const f = geocentricPhase(e);
      expect(cameraLitFraction({ sunDir: sunAt(e), moonPos: MOON, cameraPos: [0, 0, 0] })).toBeCloseTo(f, 12);
      expect(cameraLitFraction({ sunDir: sunAt(e), moonPos: MOON, cameraPos: [27, 0, 0] })).toBeCloseTo(1 - f, 12);
    });
  }
  it('the case of the user capture: 10 % lit from Earth, camera on the sunward side -> mostly sunlit disc', () => {
    const e = 36.87; const s = sunAt(e);
    expect(geocentricPhase(e)).toBeCloseTo(0.1, 3);
    const sunward = [MOON[0] + s[0] * 0.82, MOON[1] + s[1] * 0.82, 0]; // the Moon click flight (approach towards the Sun)
    expect(cameraLitFraction({ sunDir: s, moonPos: MOON, cameraPos: sunward })).toBeCloseTo(1, 12);
    const side = [MOON[0], 1, 0]; // a camera 90° off the Earth line
    expect(cameraLitFraction({ sunDir: s, moonPos: MOON, cameraPos: side })).toBeCloseTo((1 + Math.sin((e * Math.PI) / 180)) / 2, 12); // 80 %
  });
  it('accepts {x, y, z} objects (THREE.Vector3) as well as arrays', () => {
    expect(cameraLitFraction({ sunDir: { x: 1, y: 0, z: 0 }, moonPos: { x: 13.5, y: 0, z: 0 }, cameraPos: { x: 0, y: 0, z: 0 } })).toBeCloseTo(0, 12);
  });
});

describe('LOT 33b: View from Earth', () => {
  it('the target is on the Earth -> Moon line, on the Earth side, at the framing distance; from there the camera sees the phase from Earth', () => {
    const d = earthViewDistance({ moonRadius: 0.1, fovDeg: 45 });
    expect(EARTH_VIEW_FILL).toBe(0.4);
    expect(d).toBeCloseTo(0.1 / Math.tan((0.4 * 45 * Math.PI) / 180 / 2), 12); // ≈ 0.631: the Moon spans 40 % of the 45° field
    const moon = [8, 6, -9]; const pos = earthViewCameraPosition({ moonPos: moon, distance: d });
    const back = [pos[0] - moon[0], pos[1] - moon[1], pos[2] - moon[2]];
    expect(Math.hypot(...back)).toBeCloseTo(d, 12);
    const u = moon.map((v) => v / Math.hypot(...moon));
    const cosToEarth = -(back[0] * u[0] + back[1] * u[1] + back[2] * u[2]) / d;
    expect(cosToEarth).toBeCloseTo(1, 12); // exactly towards the Earth
    for (const e of [36.87, 120]) {
      const R = Math.hypot(...moon); const sun = sunAt(e);
      // put the Moon on +x for the phase check (rotation invariant)
      const p = earthViewCameraPosition({ moonPos: [R, 0, 0], distance: d });
      expect(cameraLitFraction({ sunDir: sun, moonPos: [R, 0, 0], cameraPos: p })).toBeCloseTo(geocentricPhase(e), 12);
    }
  });
  it('the flight uses that target with the existing Moon flight; any interaction stops it; the Moon click is unchanged', () => {
    const cam = text('src/earth/camera-motion.js');
    expect(cam).toContain("_moonDesiredPos.fromArray(earthViewCameraPosition({ moonPos: _moonTarget, distance: moonCam.distance }));");
    expect(cam).toContain("startMoonTracking(moonObject, null, { duration: Number.isFinite(options.duration) ? options.duration : 3.2, targetLeadMultiplier: 1.5, approach: 'earth', hold: 'static' });");
    expect(cam).toMatch(/controls\.addEventListener\('start', \(\) => \{[\s\S]{0,200}if \(moonCam\.active\) stopMoonTracking\(\);/);
    expect(cam).toContain("moonCam.approach = options.approach === 'earth' ? 'earth' : 'sun';");
    expect(cam).toContain("moonCam.hold = options.hold === 'static' ? 'static' : 'sweep';");
  });
  it('a button next to "Earthshine view" (also on mobile: full toolbar row), and the same action in the Moon details', () => {
    expect(html).toMatch(/<button id="moonEarthViewBtn" type="button" class="toolbar-span" aria-describedby="earthshineViewNote" title="[^"]+">View from Earth<\/button>/);
    expect(text('src/earth/control-panel.js')).toMatch(/byId\('moonEarthViewBtn'\)\?\.addEventListener\('click', \(\) => \{ \/\/ LOT 33b\s*viewMoonFromEarth\?\.\(\);/);
    expect(text('src/earth/app-runtime.js')).toMatch(/function viewMoonFromEarth\(\) \{\s*if \(!moonSystem\?\.moonState\?\.visible\) return false;\s*startMoonEarthView\?\.\(moonSystem\.moon\);/);
    expect(text('src/earth/app-services.js')).toContain("{ label: 'View from Earth', run: () => startMoonEarthView?.(moonSystem.moon) }");
    const mobile = html.slice(html.indexOf('@media (max-width: 760px)'), html.indexOf('</style>'));
    expect(mobile).not.toMatch(/moonEarthViewBtn|#toolbar/);
  });
});

describe('LOT 33b: the hint when the camera sees a mostly sunlit disc', () => {
  it('only while the Earthshine view is on and the camera sees > 40 % sunlit', () => {
    expect(cameraViewHint({ active: true, cameraLit: 0.7 })).toBe(true);
    expect(cameraViewHint({ active: true, cameraLit: 0.4 })).toBe(false);
    expect(cameraViewHint({ active: true, cameraLit: 0.1 })).toBe(false);
    expect(cameraViewHint({ active: false, cameraLit: 0.9 })).toBe(false);
    expect(cameraViewHint({ active: true, cameraLit: null })).toBe(false);
    expect(CAMERA_VIEW_HINT).toBe('From this viewpoint most of the disc is sunlit — use View from Earth to see the earthshine as photographed.');
  });
  it('the note shows the hint instead of the usual line; the View from Earth button is highlighted; the mode is never switched off by the angle', () => {
    const moon = text('src/earth/moon-system.js');
    expect(moon).toContain('note.textContent = state.cameraHint ? CAMERA_VIEW_HINT');
    expect(moon).toContain("document.getElementById('moonEarthViewBtn')?.classList.toggle('is-suggested', state.cameraHint);");
    const cameraView = moon.slice(moon.indexOf('function updateCameraView(camera)'), moon.indexOf('function update(camera)'));
    expect(cameraView).toContain('cameraViewHint({ active: state.exposureEv > 0, cameraLit: state.cameraLitFraction })');
    expect(cameraView).not.toMatch(/setMoonExposureEv|exposureEv\s*=[^=]|uMoonExposure/); // only the Earth phase turns it off
    expect(html).toMatch(/#moonEarthViewBtn\.is-suggested \{ border-color: rgba\(253, 230, 138, 0\.75\);/);
    expect(html).toMatch(/#earthshineViewNote \{[^}]*font-size: 12px;/); // the hint is shown in the same 12 px line
  });
  it('Moon details: "Camera view: N % of the disc sunlit" next to "Phase: N % lit from Earth", kept live', () => {
    expect(describeCameraView(0.7)).toBe('70 % of the disc sunlit');
    expect(describeCameraView(null)).toBe('unknown');
    const services = text('src/earth/app-services.js');
    const phase = services.indexOf("{ label: 'Phase',"); const camera = services.indexOf("{ label: 'Camera view',");
    expect(camera).toBeGreaterThan(phase);
    expect(services.slice(phase, camera)).not.toContain("{ label: 'Distance'"); // right after Phase
    expect(services).toContain("{ label: 'Camera view', value: Object.assign(document.createElement('span'), { id: 'moonCameraViewValue', textContent: describeCameraView(m.cameraLitFraction) }) },");
    expect(text('src/earth/moon-system.js')).toContain('if (pct !== shownCameraPct) { shownCameraPct = pct; refreshMoonCard(); }'); // LOT 33c: one live path
  });
});
