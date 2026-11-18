// LOT 22 — Living Earth export: the pure, testable parts (9:16 director profiles, editorial
// selection) plus the declared dimensions, formats and file names. The PNG capture and the
// MediaRecorder loop need a browser and stay without an automated test.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getVerticalBloomParams, getVerticalCaptionLayout, getVerticalDirectorProfile, isVerticalDirectorActive } from '../src/earth/vertical-director.js';
import { editorialSelection } from '../src/earth/reel-timeline.js';

const exportSystem = fs.readFileSync(new URL('../src/earth/export-system.js', import.meta.url), 'utf8');

describe('LOT 22 export: reel dimensions, formats and file names', () => {
  it('one source of truth: 16:9 = 1920×1080, otherwise 9:16 = 1080×1920', () => {
    expect(exportSystem).toMatch(/state\.reelAspect === '16:9'\s*\? \{ width: 1920, height: 1080 \}\s*: \{ width: 1080, height: 1920 \}/);
  });

  it('WebM candidates in order, MP4 via the H.264 conversion, WebM fallback', () => {
    expect(exportSystem).toMatch(/'video\/webm;codecs=vp9',\s*'video\/webm;codecs=vp8',\s*'video\/webm'/);
    expect(exportSystem).toContain('`${readProxyBase()}/convert-h264`');
    expect(exportSystem).toContain('`living-earth-observatory-reel-${exportStamp()}.mp4`');
    expect(exportSystem).toContain('`living-earth-observatory-reel-${exportStamp()}.webm`');
    expect(exportSystem).toContain('`${filenamePrefix}-${stamp}.png`');
  });

  it('the file stamp is the UTC ISO time with : and T replaced (YYYY-MM-DD-HH-MM-SS)', () => {
    expect(exportSystem).toContain("new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)");
    expect(new Date('2026-11-15T07:39:05.123Z').toISOString().replace(/[:T]/g, '-').slice(0, 19)).toBe('2026-11-15-07-39-05');
  });
});

describe('LOT 22 export: vertical director (9:16 only)', () => {
  const bloom = { strength: 1, radius: 0.5, threshold: 0.99 };

  it('active only when enabled and the aspect is portrait', () => {
    expect(isVerticalDirectorActive({ verticalDirector: true }, 9 / 16)).toBe(true);
    expect(isVerticalDirectorActive({ verticalDirector: true }, 16 / 9)).toBe(false);
    expect(isVerticalDirectorActive({ verticalDirector: true }, 1)).toBe(false);
    expect(isVerticalDirectorActive({ verticalDirector: false }, 9 / 16)).toBe(false);
    expect(isVerticalDirectorActive(null, 9 / 16)).toBe(false);
    expect(getVerticalDirectorProfile({ verticalDirector: true }, 16 / 9)).toBeNull();
  });

  it('a named social preset selects its profile; an unknown one falls back to custom', () => {
    const custom = getVerticalDirectorProfile({ verticalDirector: true }, 0.5);
    expect(getVerticalDirectorProfile({ verticalDirector: true, socialPreset: 'nope' }, 0.5)).toBe(custom);
    expect(getVerticalCaptionLayout({ verticalDirector: true, socialPreset: 'tiktokImpact' }, 0.5)).toEqual({
      verticalOffset: -0.42, heightRatio: 0.13, locatorStartY: 0.38, locatorStartX: -1.02,
    });
    expect(getVerticalCaptionLayout({ verticalDirector: false }, 0.5)).toBeNull();
  });

  it('bloom is scaled in 9:16 (threshold capped at 1) and untouched otherwise', () => {
    expect(getVerticalBloomParams({ verticalDirector: false }, 0.5, bloom)).toEqual(bloom);
    const vertical = getVerticalBloomParams({ verticalDirector: true, socialPreset: 'minimalPoetic' }, 0.5, bloom);
    expect(vertical.strength).toBeCloseTo(0.68, 10);
    expect(vertical.radius).toBeCloseTo(0.41, 10);
    expect(vertical.threshold).toBe(1);
  });
});

describe('LOT 22 export: editorial selection for the reel', () => {
  const helpers = { eventSortAge: (e) => e.age, eventRecency: (e) => e.recency, eventCategory: (e) => e.category };
  const events = [
    { id: 'a', age: 0, recency: 1, category: 'fire' },
    { id: 'b', age: 0, recency: 5, category: 'fire' },
    { id: 'c', age: 1, recency: 9, category: 'quake' },
    { id: 'd', age: 2, recency: 9, category: 'storm' },
    { id: 'e', age: 3, recency: 9, category: 'quake' },
  ];

  it('one event per category first (newest within the same age), then fills by order', () => {
    expect(editorialSelection(events, 3, helpers).map((e) => e.id)).toEqual(['b', 'c', 'd']);
    expect(editorialSelection(events, 5, helpers).map((e) => e.id)).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(editorialSelection(events.slice(0, 2), 3, helpers).map((e) => e.id)).toEqual(['b', 'a']);
    expect(events.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e']); // input not mutated
  });
});
