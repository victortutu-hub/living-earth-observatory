// Himalaya LOT 4 — Sentinel-2 "Satellite": COG decoding (zlib + predictor 2,
// 16 bit), scene selection, MGRS mosaic, UTM (GeographicLib references), fixed
// stretch, 40 m -> 20 m threshold, selection cache/abort, labels. No network.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { HeaderTooShortError, decodeTile, parseCogHeader, readWindow, tileRanges } from '../src/himalaya/cog-reader.js';
import { utmForward, utmZone } from '../src/himalaya/utm.js';
import {
  GAMMA, LEVEL_20M, LEVEL_40M, LOCAL_CLOUD_MAX_PCT, SATELLITE_20M_DISTANCE_KM, SCENE_CLOUD_MAX_PCT, SCL_NOTE, STRETCH_LABEL, WHITE_POINT,
  composeMosaic, footprintContains, groupPasses, minimalCover, imageBarSegment, imageGrid, lightingLabel, parseStacItems, sclCloudShare,
  selectPass, selectionSummary, sentinelAttribution, shouldLoad20m, sourceWindow, stacSearchBody, stretchLut,
} from '../src/himalaya/sentinel-scene.js';
import { FULL_LOD_DISTANCE_KM } from '../src/himalaya/patch-grid.js';
import { createSentinelClient, patchOutline, SELECTION_TTL_MS } from '../src/himalaya/sentinel-client.js';
import { FUTURE_FIELDS, IMAGE_MODES, satelliteReason } from '../src/himalaya/himalaya-app.js';
import { getTerrainPatch } from '../src/config/himalaya-terrain-patches.js';
import { getHimalayaPeak } from '../src/config/himalaya-peaks.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';

const crop = JSON.parse(fs.readFileSync(new URL('./fixtures/sentinel2-everest-40m-crop.json', import.meta.url), 'utf8'));
const inflate = async (b) => new Uint8Array(zlib.inflateSync(Buffer.from(b)));

/** Builds a small tiled, deflate + predictor-2 COG (one IFD) in memory. */
function makeCog({ width, height, tile, bits = 16, data, origin = [500000, 3100000], res = 40 }) {
  const across = Math.ceil(width / tile); const down = Math.ceil(height / tile);
  const tiles = [];
  for (let ty = 0; ty < down; ty++) for (let tx = 0; tx < across; tx++) {
    const raw = bits === 16 ? new Uint16Array(tile * tile) : new Uint8Array(tile * tile);
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
      const gx = tx * tile + x; const gy = ty * tile + y;
      raw[y * tile + x] = gx < width && gy < height ? data[gy * width + gx] : 0;
    }
    // forward predictor 2 (right to left within each row)
    for (let y = 0; y < tile; y++) for (let x = tile - 1; x > 0; x--) raw[y * tile + x] = (raw[y * tile + x] - raw[y * tile + x - 1]) & (bits === 16 ? 0xffff : 0xff);
    tiles.push(zlib.deflateSync(Buffer.from(raw.buffer)));
  }
  const entries = [
    [256, 3, [width]], [257, 3, [height]], [258, 3, [bits]], [259, 3, [8]], [277, 3, [1]], [317, 3, [2]],
    [322, 3, [tile]], [323, 3, [tile]], [324, 4, null], [325, 4, tiles.map((t) => t.length)],
    [33550, 12, [res, res, 0]], [33922, 12, [0, 0, 0, origin[0], origin[1], 0]],
  ];
  const ifdSize = 2 + entries.length * 12 + 4;
  const extraStart = 8 + ifdSize;
  const extras = []; let cursor = extraStart;
  const size = { 3: 2, 4: 4, 12: 8 };
  const dataStart = extraStart + entries.reduce((s, [, type, v]) => s + ((v || tiles).length * size[type] > 4 ? (v || tiles).length * size[type] : 0), 0);
  const offsets = []; let o = dataStart; for (const t of tiles) { offsets.push(o); o += t.length; }
  entries.find((e) => e[0] === 324)[2] = offsets;
  const buf = Buffer.alloc(o);
  buf.write('II', 0, 'latin1'); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(8, 4);
  buf.writeUInt16LE(entries.length, 8);
  entries.forEach(([tag, type, values], i) => {
    const at = 10 + i * 12;
    buf.writeUInt16LE(tag, at); buf.writeUInt16LE(type, at + 2); buf.writeUInt32LE(values.length, at + 4);
    const bytes = values.length * size[type];
    let p = at + 8;
    if (bytes > 4) { buf.writeUInt32LE(cursor, at + 8); p = cursor; cursor += bytes; }
    values.forEach((v, k) => { if (type === 3) buf.writeUInt16LE(v, p + k * 2); else if (type === 4) buf.writeUInt32LE(v, p + k * 4); else buf.writeDoubleLE(v, p + k * 8); });
  });
  buf.writeUInt32LE(0, 10 + entries.length * 12);
  tiles.forEach((t, i) => t.copy(buf, offsets[i]));
  return new Uint8Array(buf);
}

describe('COG reader (deflate zlib + predictor 2)', () => {
  const data = Uint16Array.from({ length: 40 * 24 }, (_, i) => crop.red[i % 256] + (i % 7));
  const cog = makeCog({ width: 40, height: 24, tile: 16, data });

  it('parses the IFD with georeferencing and decodes 16-bit tiles exactly', async () => {
    const [ifd] = parseCogHeader(cog);
    expect([ifd.width, ifd.height, ifd.tileWidth, ifd.bitsPerSample, ifd.predictor, ifd.compression]).toEqual([40, 24, 16, 16, 2, 8]);
    expect(ifd.origin).toEqual({ e: 500000, n: 3100000 });
    expect(ifd.resolution).toBe(40);
    const fetchRange = async (s, e) => cog.subarray(s, e + 1);
    const win = await readWindow({ ifd, window: { c0: 10, c1: 35, r0: 3, r1: 20 }, fetchRange, inflate });
    for (let y = 3; y <= 20; y++) for (let x = 10; x <= 35; x++) expect(win.data[(y - 3) * 26 + (x - 10)]).toBe(data[y * 40 + x]);
    const outside = await readWindow({ ifd, window: { c0: -2, c1: 1, r0: 22, r1: 25 }, fetchRange, inflate });
    expect(outside.data[0]).toBe(0); // outside the image stays 0 (nodata)
    expect(outside.data[(23 - 22) * 4 + 2]).toBe(data[23 * 40 + 0]);
  });

  it('merges contiguous tiles into few range requests and refuses a short header', () => {
    const [ifd] = parseCogHeader(cog);
    expect(tileRanges(ifd, { c0: 0, c1: 39, r0: 0, r1: 23 }).length).toBe(1);
    expect(tileRanges(ifd, { c0: 0, c1: 39, r0: 0, r1: 23 }, -1).length).toBe(6);
    expect(() => parseCogHeader(cog.subarray(0, 40))).toThrow(HeaderTooShortError);
    expect(decodeTile(new Uint8Array([5, 1, 1, 1]), { bitsPerSample: 8, samplesPerPixel: 1, tileWidth: 2, tileHeight: 2, predictor: 2 })).toEqual(new Uint8Array([5, 6, 1, 2]));
  });
});

describe('UTM (Krüger n^6) against GeographicLib GeoConvert', () => {
  it('matches Everest (45N) and K2 (43N) to < 1 mm', () => {
    const everest = utmForward(27.98806, 86.92521, 45);
    expect(Math.hypot(everest.e - 492645.647, everest.n - 3095881.969)).toBeLessThan(0.001);
    const k2 = utmForward(35.88165, 76.51347, 43);
    expect(Math.hypot(k2.e - 636613.988, k2.n - 3971879.524)).toBeLessThan(0.001);
    expect(utmZone(86.925)).toBe(45);
    expect(utmZone(76.51)).toBe(43);
    expect(utmZone(83.49)).toBe(44);
  });
});

describe('fixed stretch', () => {
  it('maps reflectance (DN*0.0001-0.1) through white point and gamma 2.2, identical for every scene', () => {
    const lut = stretchLut({ scale: 0.0001, offset: -0.1 });
    expect(WHITE_POINT).toBe(1.3);
    expect(GAMMA).toBe(2.2);
    expect(lut[0]).toBe(0);
    expect(lut[1000]).toBe(0); // reflectance 0
    expect(lut[14000]).toBe(255); // reflectance 1.3 = white point
    expect(lut[16000]).toBe(255); // above -> clamped
    expect(lut[7500]).toBe(Math.round(255 * (0.65 / 1.3) ** (1 / 2.2)));
    // The real Everest crop keeps texture: most pixels are not clamped.
    const values = crop.red.map((dn) => lut[dn]);
    expect(values.filter((v) => v === 255).length / values.length).toBeLessThan(0.2);
    expect(new Set(values).size).toBeGreaterThan(30);
    expect(STRETCH_LABEL).toBe('Sentinel-2 L2A B4/B3/B2, fixed stretch (white point 1.3, gamma 2.2), same for every scene');
  });
});

const square = (lon0, lat0, lon1, lat1) => ({ type: 'Polygon', coordinates: [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]] });
const stacItem = (id, datetime, cloud, datatake, tile, zone, geometry) => ({
  id, geometry, properties: { datetime, 'eo:cloud_cover': cloud, 's2:datatake_id': datatake, 'grid:code': `MGRS-${tile}`, 'mgrs:utm_zone': zone, 'view:sun_elevation': 42.7 },
  assets: ['red', 'green', 'blue', 'scl'].reduce((a, k) => ({ ...a, [k]: { href: `https://x/${id}/${k}.tif`, ...(k === 'red' ? { 'raster:bands': [{ scale: 0.0001, offset: -0.1 }] } : {}) } }), {}),
});

describe('scene selection', () => {
  const samples = [[86.9, 27.95], [86.95, 28.05]];
  const south = square(86, 27, 88, 28.02); const north = square(86, 27.98, 88, 29);
  const items = parseStacItems({ features: [
    stacItem('A-RVL', '2026-11-12T05:01:04Z', 11.85, 'T12', '45RVL', 45, south),
    stacItem('A-RVM', '2026-11-12T05:00:50Z', 0.26, 'T12', '45RVM', 45, north),
    stacItem('B-RVL', '2026-11-07T05:01:00Z', 9.04, 'T07', '45RVL', 45, south),
    stacItem('B-RVM', '2026-11-07T05:00:45Z', 0.01, 'T07', '45RVM', 45, north),
    stacItem('C-RVL', '2026-10-30T05:01:10Z', 99.8, 'T30', '45RVL', 45, south),
    stacItem('Z44', '2026-11-13T05:01:00Z', 1, 'T13', '44RQR', 44, square(85, 27, 88, 29)),
  ] });

  it('groups by pass, keeps the summit UTM zone only, and takes the max scene cloud over the tiles', () => {
    expect(items[0].scaling).toEqual({ scale: 0.0001, offset: -0.1, fromMetadata: true });
    const passes = groupPasses(items, 45, samples);
    expect(passes.map((p) => p.datatake)).toEqual(['T12', 'T07', 'T30']);
    expect(passes[0].tiles.map((t) => t.tile)).toEqual(['45RVL', '45RVM']);
    expect(passes[0].sceneCloudPct).toBe(11.85);
    expect(passes[0].coverage).toBe(1);
    expect(passes[2].coverage).toBe(0.5); // only the southern tile: the patch is not covered
    expect(footprintContains(south, 86.9, 27.95)).toBe(true);
    expect(footprintContains(south, 86.9, 28.5)).toBe(false);
  });

  it('accepts the most recent pass under both thresholds, otherwise falls back to the best available', async () => {
    const passes = groupPasses(items, 45, samples);
    const local = { T12: 23.2, T07: 4.1, T30: 0 };
    const clear = await selectPass(passes, async (p) => local[p.datatake]);
    expect(clear.status).toBe('clear');
    expect(clear.pass.datatake).toBe('T07'); // T12 fails the local SCL threshold (23.2 % >= 20 %)
    const cloudy = { T12: 23.2, T07: 31 };
    const none = await selectPass(passes, async (p) => cloudy[p.datatake]);
    expect(none.status).toBe('none');
    expect(none.best.datatake).toBe('T12');
    expect(SCENE_CLOUD_MAX_PCT).toBe(20);
    expect(LOCAL_CLOUD_MAX_PCT).toBe(20);
    // Nothing under the scene threshold: the pass with the fewest scene clouds is evaluated for "best available".
    const onlyCloudy = passes.map((p) => ({ ...p, sceneCloudPct: 50 + p.tiles.length }));
    const fallback = await selectPass(onlyCloudy, async () => 42);
    expect(fallback).toMatchObject({ status: 'none', best: { localCloudPct: 42 } });
  });

  it('keeps only the minimal set of tiles covering the patch (Everest: 2 of the 4 intersecting tiles)', () => {
    const grid = Array.from({ length: 25 }, (_, k) => [86.82 + (k % 5) * 0.05, 27.9 + Math.floor(k / 5) * 0.045]);
    const four = parseStacItems({ features: [
      stacItem('RVL', '2026-11-12T05:01:04Z', 11.85, 'T12', '45RVL', 45, square(85.9, 27.0, 87.05, 28.02)),
      stacItem('RVM', '2026-11-12T05:00:50Z', 0.26, 'T12', '45RVM', 45, square(85.9, 27.95, 87.05, 29.0)),
      stacItem('RWL', '2026-11-12T05:01:04Z', 1.8, 'T12', '45RWL', 45, square(86.95, 27.0, 88.1, 28.02)),
      stacItem('RWM', '2026-11-12T05:00:50Z', 0.0, 'T12', '45RWM', 45, square(86.95, 27.95, 88.1, 29.0)),
    ] });
    const cover = minimalCover(four, grid);
    expect(cover.map((t) => t.tile).sort()).toEqual(['45RVL', '45RVM']);
    const [pass] = groupPasses(four, 45, grid);
    expect(pass.tiles.map((t) => t.tile)).toEqual(['45RVL', '45RVM']);
    expect(pass.coverage).toBe(1);
  });

  it('counts SCL cloud classes 3/8/9/10 among valid pixels', () => {
    expect(sclCloudShare(Uint8Array.from([0, 0, 11, 11, 8, 9, 10, 3, 4, 5]))).toBeCloseTo(50, 9);
    expect(sclCloudShare(new Uint8Array(4))).toBeNull();
  });

  it('builds a 30-day STAC search over the patch polygon', () => {
    const body = stacSearchBody([[0, 0], [1, 0], [1, 1], [0, 0]], new Date('2026-11-15T12:00:00Z'));
    expect(body.collections).toEqual(['sentinel-2-l2a']);
    expect(body.datetime).toBe('2026-10-16T12:00:00.000Z/2026-11-15T12:00:00.000Z');
    expect(body.intersects.type).toBe('Polygon');
  });
});

describe('MGRS mosaic', () => {
  const lut = stretchLut({ scale: 0.0001, offset: -0.1, whitePoint: 1.3 });
  const make = (e0, n0, w, h, value, rect) => ({ bands: [0, 1, 2].map(() => new Uint16Array(w * h).fill(value)), width: w, height: h, res: 40, e0, n0, rect });

  it('fills the primary tile gaps from the other tile of the same pass, with a ~10 px feather, and resamples a 20 m offset grid', () => {
    const extent = { e0: 400000, n0: 3104000, widthM: 2000, heightM: 4000 }; // 50 x 100 px at 40 m
    // Primary (south) ends at n = 3102000; secondary (north) is offset by 20 m (grid not aligned at 40 m).
    const primary = make(399960, 3102040, 60, 60, 6000, { e0: 300000, e1: 500000, n0: 3102000, n1: 3000000 });
    primary.bands.forEach((b) => b.fill(0, 0, 60)); // first row: nodata at the tile edge
    const secondary = make(399980, 3104060, 60, 70, 8000, { e0: 300000, e1: 500000, n0: 3200000, n1: 3100000 });
    const out = composeMosaic({ extent, res: 40, sources: [primary, secondary], lut });
    expect([out.width, out.height]).toEqual([50, 100]);
    const at = (row) => out.rgba[(row * 50 + 25) * 4];
    expect(at(10)).toBe(lut[8000]); // north of the primary tile: secondary only
    expect(at(95)).toBe(lut[6000]); // deep inside the primary
    const mid = at(55); // within 10 px of the primary edge: blended
    expect(mid).toBeGreaterThan(lut[6000]);
    expect(mid).toBeLessThan(lut[8000]);
    expect(out.stats.empty).toBe(0);
  });

  it('computes the image grid in the primary 40 m grid and the source windows', () => {
    const grid = imageGrid([{ e: 482000, n: 3086000 }, { e: 503000, n: 3106000 }], { e: 399960, n: 3100020 });
    expect(Math.abs((grid.e0 - 399960) % 40)).toBe(0);
    expect(Math.abs((3100020 - grid.n0) % 40)).toBe(0);
    expect(grid.widthM % 40).toBe(0);
    expect(grid.e0).toBeLessThanOrEqual(482000 - 100);
    const win = sourceWindow(grid, { e: 399960, n: 3100020 }, 20);
    expect(win.c0).toBe((grid.e0 - 399960) / 20 - 1);
  });
});

describe('progression, cache, abort, modes and labels', () => {
  it('loads 20 m only below 15 km from the summit, separately from the 32 km mesh LOD', () => {
    expect(SATELLITE_20M_DISTANCE_KM).toBe(15);
    expect(FULL_LOD_DISTANCE_KM).toBe(32);
    expect(shouldLoad20m(18.7)).toBe(false); // default summit view: 40 m only
    expect(shouldLoad20m(14.9)).toBe(true);
    expect(shouldLoad20m(15)).toBe(false);
    expect(shouldLoad20m(null)).toBe(false);
    expect([LEVEL_40M, LEVEL_20M]).toEqual([2, 1]);
  });

  it('serves the selection from sessionStorage for 30 min and aborts with the summit', async () => {
    const peak = getHimalayaPeak('everest');
    const meta = getTerrainPatch('everest');
    const map = new Map();
    const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
    let clock = new Date('2026-11-15T10:00:00Z');
    const cached = { status: 'clear', zone: 45, pass: { datatake: 'T07' }, best: null };
    map.set('lumi-himalaya:s2-selection:everest:2026-11-15', JSON.stringify({ storedAt: clock.getTime() - 10 * 60_000, value: cached }));
    const runtime = { fetchResource: vi.fn((opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true }))) };
    const client = createSentinelClient({ runtime, storage, now: () => clock });
    const hit = await client.select(peak, meta, new AbortController().signal);
    expect(hit).toMatchObject({ status: 'clear', fromCache: true, cacheAgeMs: 10 * 60_000 });
    expect(runtime.fetchResource).not.toHaveBeenCalled();
    clock = new Date(clock.getTime() + SELECTION_TTL_MS); // now 40 min old -> refetch, then abort
    const controller = new AbortController();
    const pending = client.select(peak, meta, controller.signal);
    controller.abort(new DOMException('Summit changed', 'AbortError'));
    await expect(pending).rejects.toThrow('Summit changed');
    expect(runtime.fetchResource).toHaveBeenCalledTimes(1);
  });

  it('explains when Satellite is not shown (Terrarium, no clear scene, loading)', () => {
    const base = { userMode: 'satellite', terrainMode: 'glo30', activeId: 'everest' };
    expect(satelliteReason({ ...base, sat: { peakId: 'everest', status: 'ready', level: 2 } })).toBeNull();
    expect(satelliteReason({ ...base, terrainMode: 'terrarium', sat: { peakId: 'everest', status: 'ready', level: 2 } })).toContain('Terrarium terrain detail');
    expect(satelliteReason({ ...base, sat: { peakId: 'everest', status: 'no-clear' } })).toContain('no clear scene in the last 30 days');
    expect(satelliteReason({ ...base, userMode: 'lit', sat: null })).toBe('Lit terrain selected');
    expect(satelliteReason({ ...base, sat: { peakId: 'everest', status: 'loading', level: null } })).toContain('40 m');
    expect(IMAGE_MODES).toEqual(['satellite', 'lit']);
    expect(FUTURE_FIELDS).toEqual([]);
  });

  it('labels the image, the lighting, the selection and the attribution', () => {
    const pass = { datetime: '2026-11-07T05:01:00Z', sceneCloudPct: 9.038946, localCloudPct: 4.13, tiles: [{ tile: '45RVL', sunElevation: 44.1 }, { tile: '45RVM', sunElevation: 43.2 }] };
    expect(imageBarSegment(pass)).toBe('Image: Sentinel-2 L2A 45RVL+45RVM · 2026-11-07 05:01 UTC · cloud 9% (scene) / 4.1% (summit window) (observed)');
    expect(lightingLabel(pass)).toBe('lighting as captured on 2026-11-07, 05:01 UTC (Sun 44°)');
    expect(sentinelAttribution('2026')).toBe('Contains modified Copernicus Sentinel data 2026');
    expect(selectionSummary({ status: 'clear', pass })).toContain(SCL_NOTE);
    expect(selectionSummary({ status: 'none', best: pass })).toMatch(/^No clear scene in the last 30 days\. Best available: 2026-11-07 05:01 UTC/);
    expect(SOURCE_DEFINITIONS.sentinel2L2a.provenance).toBe('observed');
    expect(patchOutline(getTerrainPatch('k2')).ring).toHaveLength(5);
  });
});
