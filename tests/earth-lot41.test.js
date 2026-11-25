// LOT 41 step 1: while the surface loads, the screen always shows the best texture available of the same product
// (bundled 4096 x 2048, then GIBS z3 4096 x 2048); the z2 preview (2560 x 1280) no longer replaces the bundled one.
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SURFACE_LEVELS, loadBlueMarbleSurfaceTexture, shouldApplySurfaceLevel, surfaceLevelWidth, surfaceLevelsAbove } from '../src/earth/gibs-surface.js';
import { BUNDLED_BLUE_MARBLE, BUNDLED_BLUE_MARBLE_WIDTH } from '../src/earth/earth-textures.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
class Texture { constructor(image) { this.image = image; this.userData = {}; } dispose() { this.disposed = true; } }
const THREE = { CanvasTexture: Texture, SRGBColorSpace: 'srgb' };
const renderer = { capabilities: { getMaxAnisotropy: () => 16 } };
const createCanvas = (width, height) => ({ width, height, getContext: () => ({ drawImage: () => {}, imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }) });

describe('LOT 41 step 1: no z2 downgrade below the bundled texture', () => {
  it('level widths: z2 2560, z3 4096 (5120 resampled); the bundled file is 4096 wide', () => {
    expect([surfaceLevelWidth(2), surfaceLevelWidth(3)]).toEqual([2560, 4096]);
    expect(BUNDLED_BLUE_MARBLE).toBe('assets/blue-marble-ng-4096x2048.jpg');
    expect(BUNDLED_BLUE_MARBLE_WIDTH).toBe(4096);
  });

  it('only the levels at least as wide as the bundled texture are requested (-> z3); without it, both', () => {
    expect(SURFACE_LEVELS).toEqual([2, 3]); // the loader default is unchanged
    expect(surfaceLevelsAbove(BUNDLED_BLUE_MARBLE_WIDTH)).toEqual([3]);
    expect(surfaceLevelsAbove(0)).toEqual([2, 3]);
  });

  it('a narrower level never replaces the texture on screen', () => {
    expect(shouldApplySurfaceLevel(4096, 2560)).toBe(false);
    expect(shouldApplySurfaceLevel(4096, 4096)).toBe(true);
    expect(shouldApplySurfaceLevel(0, 2560)).toBe(true); // nothing decoded yet
    expect(shouldApplySurfaceLevel(undefined, 4096)).toBe(true);
  });

  it('the page loads z3 only: no /500m/2/ tile requested, one level shown, 4096 x 2048', async () => {
    const urls = [];
    const shown = [];
    const result = await loadBlueMarbleSurfaceTexture({
      THREE, renderer, createCanvas, levels: surfaceLevelsAbove(BUNDLED_BLUE_MARBLE_WIDTH),
      loadImage: async (url) => { urls.push(url); return { url, close: vi.fn() }; },
      onLevel: (texture, info) => shown.push([info.z, info.resolution, info.final]),
      log: null,
    });
    expect(urls).toHaveLength(50);
    expect(urls.every((u) => u.includes('/500m/3/'))).toBe(true);
    expect(shown).toEqual([[3, '4096x2048', true]]);
    expect(result).toMatchObject({ z: 3, resolution: '4096x2048' });
  });

  it('earth-layers wires both rules (visual lock unchanged: z3)', () => {
    const layers = text('src/earth/earth-layers.js');
    expect(layers).toContain('const surfaceLevels = surfaceVisualCase ? [3] : surfaceLevelsAbove(BUNDLED_BLUE_MARBLE_WIDTH);');
    expect(layers).toContain('if (!shouldApplySurfaceLevel(currentWidth, texture.image?.width)) {');
  });
});
