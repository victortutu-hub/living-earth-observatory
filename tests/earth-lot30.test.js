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

describe('LOT 30 PAS 2: NASA SVS Moon textures built beside CoryG89 (comparison only)', async () => {
  const crypto = await import('node:crypto');
  const { MOON_COLOR_ASSET } = await import('../src/config/moon-color.js');
  const { MOON_NORMAL_ASSET } = await import('../src/config/moon-normal.js');
  const { describeMoonTextures, moonTextureVariantFromSearch } = await import('../src/earth/moon-system.js');
  const bytes = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

  it('assets: hash names, SHA-256 and sizes as in the generated config; <= 4096x2048 each', () => {
    for (const [asset, re] of [[MOON_COLOR_ASSET, /^assets\/moon\/moon-lroc-color-4k-([0-9a-f]{10})\.jpg$/], [MOON_NORMAL_ASSET, /^assets\/moon\/moon-lola-normal-4k-([0-9a-f]{10})\.jpg$/]]) {
      const b = bytes(asset.file);
      expect(asset.file).toMatch(re);
      expect(sha(b)).toBe(asset.sha256);
      expect(asset.file.match(re)[1]).toBe(asset.sha256.slice(0, 10));
      expect(b.length).toBe(asset.bytes);
      expect([b[0], b[1], b[b.length - 2], b[b.length - 1]]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
      expect(asset.width * asset.height).toBeLessThanOrEqual(4096 * 2048);
      expect(asset.source.credit).toBe("NASA's Scientific Visualization Studio");
    }
  });

  it('provenance: colour observed (re-encoded only); normal reconstructed, 1x, scale documented', () => {
    expect(MOON_COLOR_ASSET).toMatchObject({ representation: 'observed', adjustments: 'none (re-encoded only)', width: 4096, height: 2048 });
    expect(MOON_COLOR_ASSET.source).toMatchObject({ url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif', sha256: '918649a7f8ed2f1329b2cd95bb0d25483befdcb60ae1a66db681a637cc21344f', bytes: 13095388 });
    expect(MOON_NORMAL_ASSET).toMatchObject({ representation: 'reconstructed', width: 4096, height: 2048 });
    expect(MOON_NORMAL_ASSET.scale).toMatchObject({ kmPerPixelNS: 2.665, verticalExaggeration: 1, heightUnit: 'm above the 1737.4 km sphere' });
    expect(MOON_NORMAL_ASSET.source).toMatchObject({ url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif', sha256: '45a2b32d56e81ed30db07fead8abc842b249b6511219d9ca2c53f81bc2dc5d62', tool: 'tools/build-moon-normal.mjs' });
    expect(text('tools/build-moon-color.mjs')).toContain("const SOURCE_SHA256 = '918649a7f8ed2f1329b2cd95bb0d25483befdcb60ae1a66db681a637cc21344f';");
    expect(text('tools/build-moon-normal.mjs')).toContain("const SOURCE_SHA256 = '45a2b32d56e81ed30db07fead8abc842b249b6511219d9ca2c53f81bc2dc5d62';");
  });

  it('comparison switch: only ?moonCompare=nasa; default unchanged; not in the page UI', () => {
    expect(moonTextureVariantFromSearch('')).toBe('coryg89');
    expect(moonTextureVariantFromSearch('?debug')).toBe('coryg89');
    expect(moonTextureVariantFromSearch('?moonCompare=nasa')).toBe('nasa-svs');
    expect(text('earth-eonet-relief.html')).not.toMatch(/moonCompare/);
    expect(text('earth-eonet-relief.html')).toContain('>Moon texture: CoryG89 (default)</button>');
  });

  it('Moon details: NASA SVS rows (source, resolution, provenance, credit); 1K fallback labelled; default rows unchanged', () => {
    const svs = describeMoonTextures({ textureSource: 'nasa-svs', normalAvailable: true });
    expect(svs.map((r) => r.label)).toEqual(['Texture', 'Relief shading', 'Credit']);
    expect(svs[0].value).toBe('NASA SVS CGI Moon Kit · LROC WAC colour 4096×2048 · observed (SVS: optimized for aesthetics, not science)');
    expect(svs[1].value).toBe('Normal map 4096×2048 reconstructed from LOLA topography (LDEM 16 px/deg), 2.665 km/px, vertical exaggeration 1×');
    expect(svs[2].value).toBe("NASA's Scientific Visualization Studio");
    expect(describeMoonTextures({ textureSource: 'nasa-svs', normalAvailable: false })[1].value).toMatch(/unavailable/);
    expect(describeMoonTextures({ textureSource: 'nasa-1k-fallback' })[0].value).toBe('NASA LROC WAC 1024×512 (local fallback: the 4K colour map did not load)');
    expect(describeMoonTextures({ textureSource: 'coryg89' })).toEqual([{ label: 'Texture', value: 'CoryG89 mosaic (default)' }]);
    expect(describeMoonTextures({ textureSource: 'nasa' })).toEqual([{ label: 'Texture', value: 'NASA LROC WAC (public domain)' }]);
  });
});
