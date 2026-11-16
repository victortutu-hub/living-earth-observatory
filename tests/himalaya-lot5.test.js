// Himalaya LOT 5 — scene time from Living Earth (validator, message, adapter
// ?time=, Earth sender, Himalaya reader), weather only for today, Sentinel-2
// window "up to <date>", mobile framing, collapsible panels, patch walls. No network.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OBSERVATORY_ENTER_MESSAGE, TIME_MAX_PAST_DAYS, validateObservatoryTime } from '../src/core/observatory/observatory-messages.js';
import { acceptObservatoryMessage } from '../src/atlas/observatory-module-controller.js';
import { platformRegistry } from '../src/core/platform-registry.js';
import { HIMALAYA_PEAK_IDS, getHimalayaPeak } from '../src/config/himalaya-peaks.js';
import { HIMALAYA_TERRAIN_PATCHES } from '../src/config/himalaya-terrain-patches.js';
import { createLivingHimalayaAtlasModule } from '../src/himalaya/living-himalaya-atlas-module.js';
import { enterHimalaya, historicalSceneTime } from '../src/earth/layers/himalaya-peaks.js';
import { resolveInitialTime } from '../src/himalaya/himalaya-app.js';
import { isWeatherDay, summitWeatherRows, weatherBarSegment } from '../src/himalaya/summit-weather.js';
import { selectionCacheKey, selectionSummary, stacSearchBody } from '../src/himalaya/sentinel-scene.js';
import { DEFAULT_PANEL_STATE, PANEL_STORAGE_KEY, isPanelHotkey, readPanelState, toggleAll, viewOffsetY, writePanelState } from '../src/himalaya/ui-panels.js';
import { WALL_BELOW_MIN_M, buildPatchArrays, wallBottomKm } from '../src/himalaya/patch-grid.js';
import { readKtx2R16Unorm, dequantizeHeights } from '../src/himalaya/ktx2-r16-reader.js';

const NOW = new Date('2026-11-16T09:00:00Z');

describe('scene time validator (single source)', () => {
  it('accepts ISO UTC with Z (minutes, seconds or milliseconds) and returns the canonical form', () => {
    expect(validateObservatoryTime('2026-11-06T05:00Z', NOW)).toBe('2026-11-06T05:00:00.000Z');
    expect(validateObservatoryTime('2026-11-06T05:00:30Z', NOW)).toBe('2026-11-06T05:00:30.000Z');
    expect(validateObservatoryTime('2026-11-06T05:00:30.125Z', NOW)).toBe('2026-11-06T05:00:30.125Z');
  });

  it('refuses everything else: date only, offsets, null, numbers, impossible dates, too old, future', () => {
    for (const bad of ['2026-11-06', '2026-11-06T05:00:00+02:00', '2026-11-06T05:00:00', null, undefined, 1794722400000, '', '2026-02-30T00:00Z', 'yesterday']) {
      expect(validateObservatoryTime(bad, NOW)).toBeNull();
    }
    expect(validateObservatoryTime(new Date(NOW.getTime() - (TIME_MAX_PAST_DAYS + 1) * 86400000).toISOString(), NOW)).toBeNull();
    expect(validateObservatoryTime(new Date(NOW.getTime() - 365 * 86400000).toISOString(), NOW)).not.toBeNull();
    expect(validateObservatoryTime(new Date(NOW.getTime() + 4 * 60000).toISOString(), NOW)).not.toBeNull();
    expect(validateObservatoryTime(new Date(NOW.getTime() + 6 * 60000).toISOString(), NOW)).toBeNull();
  });
});

describe('enter message with the optional time', () => {
  const frameWindow = {};
  const base = {
    origin: 'https://lumi.test', activeSource: frameWindow, activeId: 'living-earth', now: NOW,
    getObservatory: (id) => platformRegistry.getObservatory(id),
    canMount: (id) => ['living-earth', 'living-himalaya'].includes(id),
    isValidFocus: (id, focus) => id === 'living-himalaya' && HIMALAYA_PEAK_IDS.includes(focus),
  };
  const msg = (data) => ({ origin: 'https://lumi.test', source: frameWindow, data: { type: OBSERVATORY_ENTER_MESSAGE, id: 'living-himalaya', focus: 'everest', ...data } });

  it('accepts no time or a valid time', () => {
    expect(acceptObservatoryMessage(msg({}), base)).toEqual({ id: 'living-himalaya', focus: 'everest', time: null });
    expect(acceptObservatoryMessage(msg({ time: '2026-11-06T05:00:00Z' }), base)).toEqual({ id: 'living-himalaya', focus: 'everest', time: '2026-11-06T05:00:00.000Z' });
  });

  it('refuses extra keys, a null or invalid time, and a missing required key', () => {
    expect(acceptObservatoryMessage(msg({ time: '2026-11-06T05:00:00Z', extra: true }), base)).toBeNull();
    expect(acceptObservatoryMessage(msg({ time: null }), base)).toBeNull();
    expect(acceptObservatoryMessage(msg({ time: '2026-11-06' }), base)).toBeNull();
    expect(acceptObservatoryMessage(msg({ time: '2025-01-01T00:00:00Z' }), base)).toBeNull();
    const { focus, ...noFocus } = msg({}).data;
    expect(acceptObservatoryMessage({ ...msg({}), data: noFocus }, base)).toBeNull();
  });
});

describe('Earth sends the time only when the timeline is not on Live', () => {
  it('historicalSceneTime reads the time state snapshot', () => {
    expect(historicalSceneTime(() => ({ historical: false, date: NOW }))).toBeNull();
    expect(historicalSceneTime(() => ({ historical: true, date: new Date('2026-11-06T05:00:00Z') }))).toBe('2026-11-06T05:00:00.000Z');
    expect(historicalSceneTime(null)).toBeNull();
  });

  it('posts {type, id, focus[, time]} when embedded and adds &time= when standalone', () => {
    const posted = [];
    const parent = { postMessage: (data, origin) => posted.push({ data, origin }) };
    const embedded = { parent, location: { origin: 'https://lumi.test', href: 'https://lumi.test/earth-eonet-relief.html' } };
    enterHimalaya('everest', { win: embedded, time: null });
    enterHimalaya('k2', { win: embedded, time: '2026-11-06T05:00:00.000Z' });
    expect(posted[0].data).toEqual({ type: OBSERVATORY_ENTER_MESSAGE, id: 'living-himalaya', focus: 'everest' });
    expect(posted[1].data).toEqual({ type: OBSERVATORY_ENTER_MESSAGE, id: 'living-himalaya', focus: 'k2', time: '2026-11-06T05:00:00.000Z' });
    const self = { location: { href: 'https://lumi.test/earth-eonet-relief.html', assign: vi.fn() } };
    self.parent = self;
    enterHimalaya('k2', { win: self, time: '2026-11-06T05:00:00.000Z' });
    expect(self.location.assign).toHaveBeenCalledWith('https://lumi.test/living-himalaya.html?focus=k2&time=2026-11-06T05%3A00%3A00.000Z');
  });
});

describe('Himalaya adapter: switchTo -> enter -> adapter -> ?time=', () => {
  const saved = { HTMLElement: globalThis.HTMLElement, document: globalThis.document, window: globalThis.window };
  afterEach(() => { Object.assign(globalThis, saved); });

  async function startWith(options) {
    globalThis.HTMLElement = class {};
    const frame = { remove() {}, src: '' };
    globalThis.document = { createElement: () => frame };
    globalThis.window = { location: { href: 'https://lumi.test/index.html' }, setTimeout, clearTimeout };
    const mount = Object.assign(new globalThis.HTMLElement(), { replaceChildren() {} });
    const controller = new AbortController();
    const started = createLivingHimalayaAtlasModule().start({ signal: controller.signal }, { mount, ...options });
    const src = frame.src;
    controller.abort();
    await started.catch(() => {});
    return new URL(src);
  }

  it('puts a valid time on the iframe URL; an invalid one is dropped; a reload note is passed on', async () => {
    const recent = new Date(Date.now() - 10 * 86400000).toISOString();
    const withTime = await startWith({ focus: 'everest', time: recent });
    expect(withTime.searchParams.get('time')).toBe(recent);
    expect(withTime.searchParams.get('focus')).toBe('everest');
    const bad = await startWith({ focus: 'everest', time: '2026-11-06' });
    expect(bad.searchParams.has('time')).toBe(false);
    const note = await startWith({ focus: 'everest', timeNote: 'not-restored' });
    expect(note.searchParams.get('timeNote')).toBe('not-restored');
  });

  it('the Himalaya page reads ?time= with the same validator', () => {
    const recent = new Date(Date.now() - 10 * 86400000).toISOString();
    expect(resolveInitialTime(`?focus=everest&time=${encodeURIComponent(recent)}`)).toBe(recent);
    expect(resolveInitialTime('?focus=everest&time=2026-11-06')).toBeNull();
    expect(resolveInitialTime('?focus=everest')).toBeNull();
  });
});

describe('weather only for today, Sentinel-2 up to the chosen date', () => {
  it('shows "only available for today" without a request for another day', () => {
    expect(isWeatherDay(new Date('2026-11-16T23:59:00Z'), NOW)).toBe(true);
    expect(isWeatherDay(new Date('2026-11-06T05:00:00Z'), NOW)).toBe(false);
    const rows = summitWeatherRows({ peak: getHimalayaPeak('everest'), state: { peakId: 'everest', status: 'other-day' }, date: new Date('2026-11-06T05:00:00Z') });
    expect(rows).toEqual([['Summit weather', 'Summit weather: only available for today', 'pending']]);
    expect(weatherBarSegment({ status: 'other-day' }, NOW)).toBe('Weather: Open-Meteo GFS 0.25° (Model prediction), only available for today');
  });

  it('searches the 30 days up to the chosen time, caches per summit + date, and labels "up to"', () => {
    const upTo = new Date('2026-11-06T05:00:00Z');
    expect(stacSearchBody([[0, 0], [1, 0], [1, 1], [0, 0]], upTo).datetime).toBe('2026-10-07T05:00:00.000Z/2026-11-06T05:00:00.000Z');
    expect(selectionCacheKey('everest', upTo)).toBe('lumi-himalaya:s2-selection:everest:2026-11-06');
    expect(selectionCacheKey('everest', NOW)).not.toBe(selectionCacheKey('everest', upTo));
    const pass = { datetime: '2026-11-02T05:01:05Z', sceneCloudPct: 9.6, localCloudPct: 3.2, tiles: [] };
    expect(selectionSummary({ status: 'clear', pass }, { upTo: '2026-11-06T05:00:00.000Z' })).toMatch(/^Latest clear scene up to 2026-11-06 05:00 UTC: 2026-11-02 05:01 UTC/);
    expect(selectionSummary({ status: 'none', best: pass }, { upTo: '2026-11-06T05:00:00.000Z' })).toMatch(/^No clear scene in the 30 days up to 2026-11-06 05:00 UTC\. Best available/);
    expect(selectionSummary({ status: 'clear', pass })).toMatch(/^Clear scene: /);
  });
});

describe('mobile framing and desktop panels', () => {
  it('moves the principal point to the middle of the visible band', () => {
    expect(viewOffsetY({ height: 844, top: 0, bottom: 844 })).toBe(0);
    expect(viewOffsetY({ height: 844, top: 110, bottom: 393 })).toBe(Math.round(422 - (110 + 393) / 2)); // 171 px up
    expect(viewOffsetY({ height: 844, top: 110, bottom: 731 })).toBe(Math.round(422 - (110 + 731) / 2));
    expect(viewOffsetY({ height: 0 })).toBe(0);
  });

  it('keeps the panel state in sessionStorage with try/catch, toggles both with H, ignores H in fields', () => {
    const map = new Map();
    const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
    expect(readPanelState(storage)).toEqual(DEFAULT_PANEL_STATE);
    writePanelState(storage, { list: true, details: false, provenance: true });
    expect(JSON.parse(map.get(PANEL_STORAGE_KEY))).toEqual({ list: true, details: false, provenance: true });
    expect(readPanelState(storage)).toEqual({ list: true, details: false, provenance: true });
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readPanelState(broken)).toEqual(DEFAULT_PANEL_STATE);
    expect(() => writePanelState(broken, DEFAULT_PANEL_STATE)).not.toThrow();
    expect(toggleAll({ list: false, details: false, provenance: true })).toEqual({ list: true, details: true, provenance: true });
    expect(toggleAll({ list: true, details: false, provenance: false })).toEqual({ list: true, details: true, provenance: false });
    expect(toggleAll({ list: true, details: true, provenance: false })).toEqual({ list: false, details: false, provenance: false });
    const key = (target, extra = {}) => ({ key: 'h', target, ...extra });
    expect(isPanelHotkey(key({ tagName: 'CANVAS' }))).toBe(true);
    expect(isPanelHotkey(key({ tagName: 'BODY' }, { key: 'H' }))).toBe(true);
    expect(isPanelHotkey(key({ tagName: 'INPUT' }))).toBe(false); // includes the time slider (input type=range)
    expect(isPanelHotkey(key({ tagName: 'TEXTAREA' }))).toBe(false);
    expect(isPanelHotkey(key({ tagName: 'DIV', isContentEditable: true }))).toBe(false);
    expect(isPanelHotkey(key({ tagName: 'DIV', getAttribute: () => 'slider' }))).toBe(false);
    expect(isPanelHotkey(key({ tagName: 'BODY' }, { ctrlKey: true }))).toBe(false);
    expect(isPanelHotkey(key({ tagName: 'BODY' }, { key: 'j' }))).toBe(false);
  });
});

describe('patch walls', () => {
  const zstd = { decode: (d) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(d.buffer, d.byteOffset, d.byteLength))) };

  it('reach minM - 2.5 km, below every edge drop measured on the 14 patches (10 km overview smoothing)', () => {
    expect(WALL_BELOW_MIN_M).toBe(2500);
    for (const [id, meta] of Object.entries(HIMALAYA_TERRAIN_PATCHES)) {
      const k = readKtx2R16Unorm(new Uint8Array(fs.readFileSync(new URL(`../${meta.file}`, import.meta.url))), zstd);
      const h = dequantizeHeights(k.data, meta.heightOffsetM, meta.heightScaleM);
      const { rows: R, cols: C } = meta; const W = 165; // ±5 km box ~ a z6 overview spacing
      const bottomM = wallBottomKm(meta) * 1000;
      expect(bottomM).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < C; i += 24) {
        for (const j of [0, R - 1]) {
          let s = 0; let n = 0;
          for (let y = Math.max(0, j - W); y <= Math.min(R - 1, j + W); y += 9) for (let x = Math.max(0, i - W); x <= Math.min(C - 1, i + W); x += 9) { s += h[y * C + x]; n++; }
          const smoothed = s / n; // what a coarse overview can show near this edge point
          expect(bottomM, `${id} edge ${j},${i}`).toBeLessThan(smoothed);
        }
      }
    }
  });

  it('builds the walls down to the fixed bottom (not 0.6 km under the edge)', () => {
    const meta = { rows: 5, cols: 6, latTopArcsec: 28 * 3600, lonLeftArcsec: 86 * 3600, minM: 4000 };
    const heights = new Float32Array(30).fill(5000);
    const arrays = buildPatchArrays(meta, heights, { lat: 31.5, lon: 81 });
    expect(arrays.wallBottomKm).toBeCloseTo(1.5, 9);
    expect(arrays.positions[30 * 3 + 1]).toBeCloseTo(1.5, 6);
    expect(arrays.fullSurfaceCount).toBe(4 * 5 * 6);
    expect(arrays.full.length).toBeGreaterThan(arrays.fullSurfaceCount);
  });
});
