// LOT 30 — provenance of the third-party Earth textures and the Moon textures.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLOUDS_STATIC_LABEL, NIGHT_LIGHTS_FALLBACK_LABEL } from '../src/earth/earth-textures.js';
import { EARTH_TEMPORAL_LAYERS, EARTH_TIME_CAPABILITIES } from '../src/earth/temporal-provenance.js';
import { createInitialEarthState } from '../src/earth/app-state.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('LOT 30 PAS 1 + 4: Earth textures - declared local NASA sources, truthful status texts', async () => {
  const crypto = await import('node:crypto');
  const { EARTH_LOCAL_TEXTURES } = await import('../src/config/earth-local-textures.js');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

  it('no threejs.org texture is requested any more; the three local files match the config', () => {
    for (const f of ['src/earth/earth-textures.js', 'src/earth/earth-layers.js', 'src/earth/cloud-system.js', 'earth-eonet-relief.html']) {
      expect(text(f), f).not.toMatch(/https:\/\/threejs\.org|earth_specular_2048|earth_lights_2048|earth_clouds_1024/);
    }
    const { nightLights, clouds, specular } = EARTH_LOCAL_TEXTURES;
    for (const [asset, re] of [[nightLights, /^assets\/earth\/black-marble-2016-3600x1800-[0-9a-f]{10}\.jpg$/], [clouds, /^assets\/earth\/blue-marble-clouds-2048x1024-[0-9a-f]{10}\.jpg$/], [specular, /^assets\/earth\/specular-mod44w-2160x1080-[0-9a-f]{10}\.png$/]]) {
      const b = fs.readFileSync(new URL(`../${asset.file}`, import.meta.url));
      expect(asset.file).toMatch(re);
      expect(sha(b)).toBe(asset.sha256);
      expect(asset.file).toContain(asset.sha256.slice(0, 10));
      expect(b.length).toBe(asset.bytes);
      expect(asset.width * asset.height).toBeLessThanOrEqual(4096 * 2048);
    }
    // The two NASA images are byte-for-byte the downloaded files.
    expect(nightLights.sha256).toBe(nightLights.source.sha256);
    expect(clouds.sha256).toBe(clouds.source.sha256);
    expect(nightLights.source.url).toBe('https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg');
    expect(clouds.source).toMatchObject({ credit: 'Image by Reto Stöckli (land surface, shallow water, clouds).', terms: 'These images are freely available to educators, scientists, museums, and the public.' });
    expect(specular.source.file).toBe('assets/mod44w-water-2160x1080.png');
  });

  it('labels: night-lights fallback is local NASA Black Marble 2016; clouds a static NASA image, not today\'s', () => {
    expect(NIGHT_LIGHTS_FALLBACK_LABEL).toBe('local fallback (NASA Black Marble 2016, Earth Observatory 0.1° map, 3600×1800)');
    expect(CLOUDS_STATIC_LABEL).toBe("static image (NASA Blue Marble clouds, 2002 release, MODIS; image by Reto Stöckli) — not today's clouds");
    expect(text('src/earth/earth-layers.js').match(/\$\{NIGHT_LIGHTS_FALLBACK_LABEL\}/g)).toHaveLength(5);
    const all = ['src/earth/earth-layers.js', 'src/earth/cloud-system.js', 'src/earth/app-state.js', 'src/earth/surface-visual-lock.js', 'src/earth/temporal-provenance.js', 'earth-eonet-relief.html'].map(text).join('\n');
    for (const claim of [/stable bundled fallback/, /stable procedural layer/, /artistic procedural layer/, /artistic fallback/, /Procedural cloud layer/, /source undeclared/]) expect(all).not.toMatch(claim);
  });

  it('initial cloud status (state + page), temporal descriptor and the luma-alpha shader switch', () => {
    expect(createInitialEarthState().cloudSourceMessage).toBe(`Clouds: NASA GIBS daily snapshot temporarily paused; ${CLOUDS_STATIC_LABEL}`);
    expect(text('earth-eonet-relief.html')).toContain(`<div id="cloudSourceStatus" data-state="paused">Clouds: NASA GIBS daily snapshot temporarily paused; ${CLOUDS_STATIC_LABEL}</div>`);
    expect(EARTH_TEMPORAL_LAYERS.clouds.temporalType).toBe('static-reference');
    expect(EARTH_TIME_CAPABILITIES.clouds.note).toMatch(/NASA Blue Marble cloud image .*not the clouds of the chosen day/);
    expect(text('src/earth/cloud-shaders.js')).toContain('if (uMapLumaAlpha > 0.5) c = vec4(1.0, 1.0, 1.0, c.r);');
    expect(text('src/earth/cloud-setup.js')).toContain('lumaAlpha: true');
    expect(text('src/earth/earth-textures.js')).toContain('earthClouds.colorSpace = THREE.NoColorSpace;');
  });
});

describe('LOT 30 PAS 2-3: NASA SVS Moon textures (the only Moon textures since PAS 3)', async () => {
  const crypto = await import('node:crypto');
  const { MOON_COLOR_ASSET } = await import('../src/config/moon-color.js');
  const { MOON_NORMAL_ASSET } = await import('../src/config/moon-normal.js');
  const { describeMoonTextures, MOON_TEXTURE_CREDIT_LABEL } = await import('../src/earth/moon-system.js');
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

  it('PAS 3: CoryG89, the comparison switch and the "Moon texture" button are gone', () => {
    const files = ['src/earth/moon-system.js', 'src/earth/app-runtime.js', 'src/earth/control-panel.js', 'src/earth/app-services.js', 'earth-eonet-relief.html', 'NOTICE.md'];
    for (const f of files) expect(text(f), f).not.toMatch(/CoryG89|coryg89|moonCompare|moonTextureBtn|toggleMoonTexture|cdn\.jsdelivr\.net\/gh/);
    for (const f of files.filter((f) => f !== 'NOTICE.md')) expect(text(f), f).not.toMatch(/public[ -]domain\)?[^.]*Moon|Moon[^.<]*public[ -]domain/i);
    expect(text('src/earth/moon-system.js')).toContain('normalScale: new THREE.Vector2(1, 1)');
    expect(text('src/earth/moon-system.js')).not.toMatch(/Vector2\(0\.6, 0\.6\)/);
    expect(text('src/earth/control-panel.js')).toContain("byId('moonMarkersBtn')?.addEventListener('click', () => {");
  });

  it('Moon details: NASA SVS by default (source, resolution, provenance, credit); LROC 1K fallback labelled', () => {
    const svs = describeMoonTextures({ textureSource: 'nasa-svs', normalAvailable: true });
    expect(svs.map((r) => r.label)).toEqual(['Texture', 'Relief shading', 'Source']);
    expect(svs[0].value).toBe('LROC WAC colour 4096×2048 · observed (SVS: optimized for aesthetics, not science)');
    expect(svs[1].value).toBe('Normal map 4096×2048 reconstructed from LOLA topography (LDEM 16 px/deg), 2.665 km/px, vertical exaggeration 1×');
    expect(svs[2].value).toBe("NASA SVS CGI Moon Kit — credit: NASA's Scientific Visualization Studio (NASA media guidelines)");
    expect(MOON_TEXTURE_CREDIT_LABEL).toBe(svs[2].value);
    expect(describeMoonTextures({ textureSource: 'nasa-svs', normalAvailable: false })[1].value).toMatch(/unavailable/);
    expect(describeMoonTextures({ textureSource: 'nasa-1k-fallback' })[0].value).toMatch(/^NASA LROC 1K \(fallback\): LROC WAC colour 1024×512, local/);
    expect(text('src/earth/moon-system.js')).toContain("textureSource: 'nasa-svs',");
  });
});

describe('LOT 30 PAS 5: Inter served locally', async () => {
  const crypto = await import('node:crypto');
  const css = text('styles/inter.css');
  it('no Google Fonts on the three pages; one versioned local stylesheet instead', () => {
    for (const p of ['index.html', 'living-himalaya.html', 'living-protein.html']) {
      expect(text(p), p).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
      expect(text(p), p).toMatch(/<link rel="stylesheet" href="\.\/styles\/inter\.css\?v=lot30inter1"/);
    }
  });
  it('the @font-face weights are the ones the pages requested (200-600), one hashed woff2 + OFL', () => {
    expect([...css.matchAll(/font-weight: (\d+);/g)].map((m) => Number(m[1]))).toEqual([200, 300, 400, 500, 600]);
    const files = [...new Set([...css.matchAll(/url\('\.\.\/(assets\/fonts\/[^']+)'\)/g)].map((m) => m[1]))];
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^assets\/fonts\/inter-4\.1-var-([0-9a-f]{10})\.woff2$/);
    const b = fs.readFileSync(new URL(`../${files[0]}`, import.meta.url));
    const sha = crypto.createHash('sha256').update(b).digest('hex');
    expect(files[0]).toContain(sha.slice(0, 10));
    expect(css).toContain(`sha256 ${sha}`);
    expect(b.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(text('assets/fonts/OFL.txt')).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(text('tools/build-inter-font.py')).toContain("SOURCE_SHA256 = '9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e'");
    expect(css).toMatch(/unicode-range: U\+0000-00FF/);
  });
});
