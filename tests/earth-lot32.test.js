// LOT 32: Moon textures decoded off the main thread + idle GPU warm-up (src/earth/moon-prewarm.js).
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MOON_PREWARM_MOBILE_MAX_PX, createMoonPrewarm, loadTextureBitmapFirst, moonBitmapOptions, moonPrewarmDecision, moonPrewarmSkippedMessage } from '../src/earth/moon-prewarm.js';
import { MOBILE_LAYOUT_MAX_PX } from '../src/earth/perf/earth-layout-checks.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

// Minimal THREE stand-in: Texture, TextureLoader and ImageBitmapLoader whose outcomes the test controls.
function fakeThree({ bitmap = 'ok', image = 'ok' } = {}) {
  const calls = { bitmapOptions: null, bitmapLoads: [], imageLoads: [] };
  class Texture { constructor() { this.image = undefined; this.flipY = true; this.version = 0; this.userData = {}; } set needsUpdate(v) { if (v) this.version += 1; } }
  class TextureLoader {
    load(file, onLoad, _p, onError) {
      calls.imageLoads.push(file);
      const t = new Texture();
      queueMicrotask(() => (image === 'ok' ? (t.image = { kind: 'img', file }, onLoad(t)) : onError(new Error('404'))));
      return t;
    }
  }
  class ImageBitmapLoader {
    setOptions(o) { calls.bitmapOptions = o; return this; }
    load(file, onLoad, _p, onError) {
      calls.bitmapLoads.push(file);
      queueMicrotask(() => (bitmap === 'ok' ? onLoad({ kind: 'bitmap', file, close: vi.fn() }) : onError(new Error('decode failed'))));
    }
  }
  return { THREE: { Texture, TextureLoader, ImageBitmapLoader, NoColorSpace: '', SRGBColorSpace: 'srgb' }, calls };
}

describe('LOT 32: loadTextureBitmapFirst', () => {
  it('decodes through createImageBitmap with the same orientation / alpha / colour handling as the <img> upload', async () => {
    const { THREE, calls } = fakeThree();
    const onLoad = vi.fn(); const onError = vi.fn();
    const { texture, ready } = loadTextureBitmapFirst({ THREE, file: 'moon.jpg', colorSpace: THREE.SRGBColorSpace, onLoad, onError, hasCreateImageBitmap: true });
    expect(texture.version).toBe(0); // nothing to upload before the decode finishes
    expect(await ready).toBe(true);
    expect(texture.image.kind).toBe('bitmap');
    expect(texture.flipY).toBe(false); // flipped by imageOrientation instead
    expect(texture.version).toBe(1);
    expect(texture.anisotropy).toBe(4);
    expect(calls.bitmapOptions).toEqual({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
    expect(calls.imageLoads).toEqual([]);
    expect(onLoad).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled();
    expect(texture.userData.decode.path).toBe('image-bitmap');
  });

  it('data textures (normal, elevation) get no colour conversion', () => {
    expect(moonBitmapOptions({ colorTexture: false }).colorSpaceConversion).toBe('none');
    const { THREE, calls } = fakeThree();
    loadTextureBitmapFirst({ THREE, file: 'n.jpg', colorSpace: THREE.NoColorSpace, hasCreateImageBitmap: true });
    expect(calls.bitmapOptions.colorSpaceConversion).toBe('none');
  });

  it('if the bitmap decode fails, falls back to the previous <img> path without reporting an error', async () => {
    const { THREE, calls } = fakeThree({ bitmap: 'fail' });
    const onError = vi.fn();
    const { texture, ready } = loadTextureBitmapFirst({ THREE, file: 'moon.jpg', colorSpace: THREE.SRGBColorSpace, onError, hasCreateImageBitmap: true });
    expect(await ready).toBe(true);
    expect(calls.imageLoads).toEqual(['moon.jpg']);
    expect(texture.image.kind).toBe('img');
    expect(texture.flipY).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(texture.userData.decode).toEqual({ path: 'image', reason: 'image bitmap failed: decode failed' });
  });

  it('without createImageBitmap, uses the previous <img> path directly', async () => {
    const { THREE, calls } = fakeThree();
    const { ready } = loadTextureBitmapFirst({ THREE, file: 'm.jpg', colorSpace: THREE.SRGBColorSpace, hasCreateImageBitmap: false });
    expect(await ready).toBe(true);
    expect(calls.bitmapLoads).toEqual([]);
    expect(calls.imageLoads).toEqual(['m.jpg']);
  });

  it('reports the error (the LROC 1K fallback trigger) only when both paths fail', async () => {
    const { THREE } = fakeThree({ bitmap: 'fail', image: 'fail' });
    const onError = vi.fn();
    const { ready } = loadTextureBitmapFirst({ THREE, file: 'moon.jpg', colorSpace: THREE.SRGBColorSpace, onError, hasCreateImageBitmap: true });
    expect(await ready).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('a late bitmap for a stopped owner is closed and ignored', async () => {
    const { THREE } = fakeThree();
    let active = true; const onLoad = vi.fn();
    const { texture, ready } = loadTextureBitmapFirst({ THREE, file: 'm.jpg', colorSpace: THREE.SRGBColorSpace, onLoad, isActive: () => active, hasCreateImageBitmap: true });
    active = false;
    expect(await ready).toBe(false);
    expect(texture.image).toBeUndefined();
    expect(onLoad).not.toHaveBeenCalled();
  });
});

function fakeRenderer() {
  const log = [];
  let target = null;
  return {
    log,
    initTexture: (t) => log.push(['init', t.name]),
    getRenderTarget: () => target,
    setRenderTarget: (t) => { target = t; log.push(['target', t?.name ?? null]); },
    compileAsync: vi.fn((object) => { log.push(['compile', object.name, target?.name ?? null]); return Promise.resolve(new Set()); }),
  };
}
function manualIdle() {
  const queue = [];
  return { queue, schedule: (task) => { const entry = { task, cancelled: false }; queue.push(entry); return () => { entry.cancelled = true; }; }, async runAll() { while (queue.length) { const e = queue.shift(); if (!e.cancelled) e.task(); await flush(); } } };
}

describe('LOT 32: createMoonPrewarm', () => {
  const textures = [{ name: 'color', image: {} }, { name: 'normal', image: {} }, null, { name: 'color', image: {} }, { name: 'empty', image: undefined }];
  textures[3] = textures[0]; // the same texture twice (bumpMap = displacementMap) is uploaded once

  it('does no GPU work synchronously in start(): the first render is never blocked', async () => {
    const renderer = fakeRenderer(); const idle = manualIdle();
    const p = createMoonPrewarm({ renderer, scene: {}, camera: {}, objects: [{ name: 'moon' }], getTextures: () => textures, ready: Promise.resolve(), scheduleIdle: idle.schedule, whenLoaded: () => Promise.resolve() });
    p.start();
    expect(renderer.log).toEqual([]);
    await flush();
    expect(renderer.log).toEqual([]); // still only queued for idle time
    expect(idle.queue.length).toBe(1);
  });

  it('waits for the page load and the textures, uploads each texture in its own idle slot, then compiles with the RenderPass target bound', async () => {
    const renderer = fakeRenderer(); const idle = manualIdle();
    let loaded; const whenLoaded = () => new Promise((r) => { loaded = r; });
    const p = createMoonPrewarm({ renderer, scene: {}, camera: {}, objects: [{ name: 'moon' }, { name: 'halo' }], getTextures: () => textures, ready: Promise.resolve(), scheduleIdle: idle.schedule, whenLoaded, getRenderTarget: () => ({ name: 'readBuffer' }) });
    p.start(); await flush();
    expect(idle.queue.length).toBe(0); // page not loaded yet
    loaded(); await flush();
    expect(idle.queue.length).toBe(1);
    await idle.runAll(); await flush();
    expect(renderer.log).toEqual([
      ['init', 'color'], ['init', 'normal'],
      ['target', 'readBuffer'], ['compile', 'moon', 'readBuffer'], ['compile', 'halo', 'readBuffer'], ['target', null],
    ]);
    expect(p.status).toMatchObject({ state: 'done', textures: 2, compiled: true, error: null });
  });

  it('cancel() (module stopped) stops the remaining work and cancels the pending idle callback', async () => {
    const renderer = fakeRenderer(); const idle = manualIdle();
    const p = createMoonPrewarm({ renderer, scene: {}, camera: {}, objects: [{ name: 'moon' }], getTextures: () => textures, ready: Promise.resolve(), scheduleIdle: idle.schedule, whenLoaded: () => Promise.resolve() });
    p.start(); await flush();
    const first = idle.queue.shift(); first.task(); await flush(); // first texture uploaded
    expect(idle.queue.length).toBe(1); // the second upload is queued
    p.cancel();
    expect(idle.queue.every((e) => e.cancelled)).toBe(true);
    await idle.runAll(); await flush();
    expect(renderer.log).toEqual([['init', 'color']]);
    expect(renderer.compileAsync).not.toHaveBeenCalled();
    expect(p.status.state).toBe('cancelled');
    p.start(); await flush();
    expect(idle.queue.length).toBe(0); // terminal: start() after cancel() does nothing
  });

  it('a failure is logged and leaves the previous behaviour (load on first view); the render target is restored', async () => {
    const renderer = fakeRenderer(); const idle = manualIdle(); const warn = vi.fn();
    renderer.compileAsync = vi.fn(() => Promise.reject(new Error('context lost')));
    const p = createMoonPrewarm({ renderer, scene: {}, camera: {}, objects: [{ name: 'moon' }], getTextures: () => [], ready: Promise.resolve(), scheduleIdle: idle.schedule, whenLoaded: () => Promise.resolve(), getRenderTarget: () => ({ name: 'rt' }), warn });
    p.start(); await flush(); await idle.runAll(); await flush();
    expect(p.status).toMatchObject({ state: 'failed', error: 'context lost' });
    expect(warn).toHaveBeenCalledOnce();
    expect(renderer.getRenderTarget()).toBe(null);
  });

  it('without compileAsync (older renderer) it still uploads the textures', async () => {
    const renderer = fakeRenderer(); delete renderer.compileAsync; const idle = manualIdle();
    const p = createMoonPrewarm({ renderer, scene: {}, camera: {}, objects: [], getTextures: () => textures, ready: Promise.resolve(), scheduleIdle: idle.schedule, whenLoaded: () => Promise.resolve() });
    p.start(); await flush(); await idle.runAll(); await flush();
    expect(p.status).toMatchObject({ state: 'done', textures: 2, compiled: false });
  });
});

describe('LOT 32: wiring in the Moon system', () => {
  const moon = text('src/earth/moon-system.js');
  it('the Moon colour, normal and elevation maps go through the bitmap-first loader; the LROC 1K fallback stays on TextureLoader', () => {
    expect(moon).toContain("import { MOON_PREWARM_MOBILE_MAX_PX, createMoonPrewarm, loadTextureBitmapFirst, moonPrewarmDecision, moonPrewarmSkippedMessage } from './moon-prewarm.js';");
    expect(moon).toMatch(/function loadMoonAsset\([^)]*\) \{\n\s+return loadTextureBitmapFirst\(/);
    expect(moon).toMatch(/function createMoonDisplacementTexture\(THREE, isActive\) \{[\s\S]*?loadTextureBitmapFirst\(/);
    expect(moon).toMatch(/function createMoonTextureNasa\(THREE, onSettled = \(\) => \{\}\) \{\n[^\n]*\n[^\n]*\n\s+const texture = loader\.load\(/);
    expect(moon).toContain('moonTextureFallback = moonTextureFallback || createMoonTextureNasa(THREE, settleColor);');
  });
  it('the warm-up starts at creation, covers Moon + halo, and stop() cancels it (terminal)', () => {
    expect(moon).toContain('objects: [moon, moonHalo],');
    expect(moon).toContain('prewarm?.start();');
    expect(moon).toMatch(/function stop\(\) \{\n\s+stopped = true;[^\n]*\n\s+prewarm\?\.cancel\(\);/);
    expect(text('src/earth/app-visual-foundation.js')).toContain('createMoonSystem({ THREE, scene, sunLight, lonLatToVec3, getDate, renderer, camera, getRenderTarget: () => sceneRuntime.composer?.readBuffer || null, afterBloom: sceneRuntime.afterBloom || null });'); // LOT 38 PAS 3: + afterBloom
  });
});

describe('LOT 32: Moon warm-up only when the device memory allows it', () => {
  it('deviceMemory >= 4 GB -> warm-up, whatever the layout', () => {
    expect(moonPrewarmDecision({ deviceMemory: 8, innerWidth: 1528 })).toEqual({ warm: true, reason: 'deviceMemory 8 GB' });
    expect(moonPrewarmDecision({ deviceMemory: 4, innerWidth: 360 })).toEqual({ warm: true, reason: 'deviceMemory 4 GB' });
  });
  it('deviceMemory < 4 GB -> no warm-up (first-view load, as before)', () => {
    expect(moonPrewarmDecision({ deviceMemory: 2, innerWidth: 1528 })).toEqual({ warm: false, reason: 'deviceMemory 2 GB (< 4 GB)' });
    expect(moonPrewarmDecision({ deviceMemory: 0.5, innerWidth: 360 }).warm).toBe(false);
  });
  it('deviceMemory not reported -> warm-up only in the desktop layout (> 760 px, the layout-check width)', () => {
    expect(MOON_PREWARM_MOBILE_MAX_PX).toBe(MOBILE_LAYOUT_MAX_PX);
    expect(moonPrewarmDecision({ deviceMemory: undefined, innerWidth: 1528 })).toEqual({ warm: true, reason: 'deviceMemory not reported, desktop layout' });
    expect(moonPrewarmDecision({ deviceMemory: undefined, innerWidth: 761 }).warm).toBe(true);
    expect(moonPrewarmDecision({ deviceMemory: undefined, innerWidth: 760 })).toEqual({ warm: false, reason: 'deviceMemory not reported, mobile layout' });
    expect(moonPrewarmDecision({ deviceMemory: undefined, innerWidth: 360 }).warm).toBe(false);
  });
  it('the skipped branch: one informative console line; the decoding stays off the main thread; nothing new in the Moon details', () => {
    expect(moonPrewarmSkippedMessage('deviceMemory 2 GB (< 4 GB)')).toBe('[Moon] GPU warm-up skipped (deviceMemory 2 GB (< 4 GB)): the Moon textures upload on its first view; decoding stays off the main thread.');
    const moon = text('src/earth/moon-system.js');
    expect(moon).toContain('if (renderer && camera && !prewarmDecision.warm) console.info(moonPrewarmSkippedMessage(prewarmDecision.reason));');
    expect(moon).toContain('const prewarm = renderer && camera && prewarmDecision.warm ? createMoonPrewarm({');
    expect(moon.match(/console\.info\(moonPrewarmSkippedMessage\(/g)).toHaveLength(1); // the only new console line
    // The textures go through loadTextureBitmapFirst in both branches (it does not depend on the decision).
    expect(moon.indexOf('loadMoonAsset(THREE, MOON_COLOR_ASSET.file')).toBeLessThan(moon.indexOf('prewarmDecision.warm ?'));
    const details = moon.slice(moon.indexOf('export function describeMoonTextures'), moon.indexOf('function handleTextureLoadError'));
    expect(details).not.toMatch(/prewarm|warm-up|deviceMemory/);
  });
});
