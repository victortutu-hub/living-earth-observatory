// LOT 30 — provenance of the third-party Earth textures and the Moon textures.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THREEJS_CLOUDS_LABEL, THREEJS_NIGHT_LIGHTS_LABEL, THREEJS_TEXTURE_BASE } from '../src/earth/earth-textures.js';
import { EARTH_TEMPORAL_LAYERS, EARTH_TIME_CAPABILITIES } from '../src/earth/temporal-provenance.js';
import { createInitialEarthState } from '../src/earth/app-state.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('LOT 30 PAS 1: status texts tell where the threejs.org textures come from', () => {
  it('the labels name threejs.org and the undeclared source', () => {
    expect(THREEJS_TEXTURE_BASE).toBe('https://threejs.org/examples/textures/planets/');
    expect(THREEJS_NIGHT_LIGHTS_LABEL).toMatch(/earth_lights_2048\.png from threejs\.org \(source undeclared\)/);
    expect(THREEJS_CLOUDS_LABEL).toMatch(/static cloud image earth_clouds_1024\.png from threejs\.org .*not today's clouds/);
  });

  it('no night-lights or cloud text claims "local", "bundled" or "procedural" any more', () => {
    const files = ['src/earth/earth-layers.js', 'src/earth/cloud-system.js', 'src/earth/app-state.js', 'src/earth/surface-visual-lock.js', 'src/earth/temporal-provenance.js', 'earth-eonet-relief.html'];
    const all = files.map(text).join('\n');
    for (const claim of [/Black Marble: [^'`"]*local fallback/, /stable bundled fallback/, /stable procedural layer/, /artistic procedural layer/, /artistic fallback/, /Procedural cloud layer/, /night lights \(2016\), with local fallback/]) {
      expect(all).not.toMatch(claim);
    }
    // Every Black Marble fallback message uses the label.
    expect(text('src/earth/earth-layers.js').match(/\$\{THREEJS_NIGHT_LIGHTS_LABEL\}/g)).toHaveLength(5);
  });

  it('initial cloud status (state + page) and temporal descriptors match the real source', () => {
    expect(createInitialEarthState().cloudSourceMessage).toBe(`Clouds: NASA GIBS daily snapshot temporarily paused; ${THREEJS_CLOUDS_LABEL}`);
    expect(text('earth-eonet-relief.html')).toContain(`<div id="cloudSourceStatus" data-state="paused">Clouds: NASA GIBS daily snapshot temporarily paused; ${THREEJS_CLOUDS_LABEL}</div>`);
    expect(EARTH_TEMPORAL_LAYERS.clouds.temporalType).toBe('static-reference');
    expect(EARTH_TIME_CAPABILITIES.clouds.note).toMatch(/threejs\.org .*not observed clouds/);
  });
});
