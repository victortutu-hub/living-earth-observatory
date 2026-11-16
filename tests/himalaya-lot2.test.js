// Himalaya LOT 2 — Terrarium decoding, projection, R16_UNORM KTX2 reader,
// patch metadata against the bundled assets, Sun position, tile LRU, bottom
// sheet, provenance wording, registry and service-worker rules. No network.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { HIMALAYA_PEAKS, HIMALAYA_REGION_CENTER } from '../src/config/himalaya-peaks.js';
import { HIMALAYA_TERRAIN_PATCHES, GLO30_ACCESSED, getTerrainPatch } from '../src/config/himalaya-terrain-patches.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import {
  childTiles, createLru, decodeTerrarium, encodeTerrariumPixel, latToTileY, lonToTileX, regionTiles,
  terrariumUrl, tileBounds, tileXToLon, tileYToLat,
} from '../src/himalaya/terrarium.js';
import { EARTH_RADIUS_KM, greatCircleKm, heightKm, localBasis, projectLonLat, unprojectXZ, VERTICAL_EXAGGERATION } from '../src/himalaya/projection.js';
import { dequantizeHeights, readKtx2R16Unorm, VK_FORMAT_R16_UNORM } from '../src/himalaya/ktx2-r16-reader.js';
import { encodeKtx2R16, encodeKtx2R16F, toHalfBits } from '../tools/lib/ktx2-r16f.mjs';
import { buildPatchArrays, decodePatch, gridIndices, patchCornersXZ, strideIndices } from '../src/himalaya/patch-grid.js';
import {
  approximateSun, astronomySun, computeSun, dateAtUtcMinutes, formatClock, localMeanSolarMinutes, sunDirectionScene,
} from '../src/himalaya/sun-position.js';
import { createBottomSheet, nextSheetState, sheetAriaExpanded, SHEET_STATES } from '../src/himalaya/bottom-sheet.js';
import { ATTRIBUTIONS, composeProvenanceBar, demElevationText, glo30FillNote, TERRAIN_LABELS } from '../src/himalaya/himalaya-provenance.js';
import { demRowText, terrainRowText, FUTURE_FIELDS } from '../src/himalaya/himalaya-app.js';

const zstd = { decode: (data) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) };
const C = HIMALAYA_REGION_CENTER;

describe('Terrarium decoding and tile maths', () => {
  it('decodes R*256 + G + B/256 - 32768 (round trip within 1/256 m)', () => {
    const heights = [-430.5, 0, 1234.25, 5000.75, 8848.86];
    const rgba = new Uint8ClampedArray(heights.length * 4);
    heights.forEach((h, i) => { rgba.set([...encodeTerrariumPixel(h), 255], i * 4); });
    const out = decodeTerrarium(rgba, heights.length, 1);
    heights.forEach((h, i) => expect(Math.abs(out[i] - h)).toBeLessThanOrEqual(1 / 256 + 1e-9));
    expect(decodeTerrarium(new Uint8ClampedArray([128, 0, 0, 255]), 1, 1)[0]).toBe(0);
  });

  it('builds the AWS URL and inverts lon/lat <-> tile coordinates', () => {
    expect(terrariumUrl(8, 189, 107)).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/8/189/107.png');
    expect(Math.floor(lonToTileX(86.925, 8))).toBe(189);
    expect(Math.floor(latToTileY(27.988, 8))).toBe(107);
    expect(tileXToLon(lonToTileX(81.3, 9), 9)).toBeCloseTo(81.3, 9);
    expect(tileYToLat(latToTileY(35.88, 9), 9)).toBeCloseTo(35.88, 9);
  });

  it('covers the 26-46°N / 67-103°E region with the tile counts measured in ETAPA 0', () => {
    expect(regionTiles(6)).toHaveLength(48);
    expect(regionTiles(8)).toHaveLength(486);
    expect(regionTiles(9)).toHaveLength(1872);
    const z6 = regionTiles(6)[10];
    const kids = childTiles(z6);
    expect(kids.length).toBeGreaterThan(0);
    expect(kids.length).toBeLessThanOrEqual(16);
    expect(kids.every((k) => k.z === 8)).toBe(true);
    expect(childTiles(kids[0]).every((k) => k.z === 9)).toBe(true);
    expect(childTiles({ z: 9, x: 379, y: 214 })).toEqual([]);
    const b = tileBounds({ z: 8, x: 189, y: 107 });
    expect(b.lonMin).toBeLessThan(86.925);
    expect(b.lonMax).toBeGreaterThan(86.925);
  });
});

describe('azimuthal equidistant projection (one projection for everything)', () => {
  it('is exact in distance from the centre and invertible', () => {
    expect(projectLonLat(C.lon, C.lat, C)).toEqual({ x: 0, z: -0 });
    for (const peak of HIMALAYA_PEAKS) {
      const p = projectLonLat(peak.lon, peak.lat, C);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(greatCircleKm(C.lat, C.lon, peak.lat, peak.lon), 6);
      const back = unprojectXZ(p.x, p.z, C);
      expect(back.lat).toBeCloseTo(peak.lat, 9);
      expect(back.lon).toBeCloseTo(peak.lon, 9);
    }
  });

  it('keeps local scale errors under the reported thresholds (0.25 % at the summits, 1.8 % at the region corner)', () => {
    const localError = (lon, lat) => {
      const dLon = 1 / (111.32 * Math.cos((lat * Math.PI) / 180)); // ~1 km east
      const a = projectLonLat(lon, lat, C); const b = projectLonLat(lon + dLon, lat, C);
      const projected = Math.hypot(b.x - a.x, b.z - a.z);
      const truth = greatCircleKm(lat, lon, lat, lon + dLon);
      return Math.abs(projected / truth - 1);
    };
    for (const peak of HIMALAYA_PEAKS) expect(localError(peak.lon, peak.lat)).toBeLessThan(0.0025);
    expect(localError(67, 46)).toBeLessThan(0.018);
    expect(EARTH_RADIUS_KM).toBeCloseTo(6371.0088, 4);
  });

  it('uses vertical exaggeration 1.0 and a local basis that is unit length and orthogonal', () => {
    expect(VERTICAL_EXAGGERATION).toBe(1);
    expect(heightKm(8848.86)).toBeCloseTo(8.84886, 9);
    const basis = localBasis(86.925, 27.988, C);
    expect(Math.hypot(basis.east.x, basis.east.z)).toBeCloseTo(1, 9);
    // Not conformal: at Everest east/north are ~0.1° away from orthogonal (< 0.3° allowed).
    expect(Math.abs(basis.east.x * basis.north.x + basis.east.z * basis.north.z)).toBeLessThan(0.005);
    expect(basis.north.z).toBeLessThan(0); // north is -z
  });
});

describe('R16_UNORM KTX2 (writer in tools/lib, reader in src/himalaya)', () => {
  const width = 37; const height = 23; const offset = 4406.75; const scale = 0.25;
  const truth = Float32Array.from({ length: width * height }, (_, i) => 4406.9 + ((i * 7919) % 17000) * 0.2537);
  const q = Uint16Array.from(truth, (h) => Math.round((h - offset) / scale));
  const ktx = encodeKtx2R16({ vkFormat: VK_FORMAT_R16_UNORM, levels: [{ width, height, data: q }], keyValues: { 'LUMI.heightOffsetM': String(offset), 'LUMI.heightScaleM': String(scale) } });

  it('round-trips with an error of at most 0.125 m', () => {
    const decoded = readKtx2R16Unorm(new Uint8Array(ktx), zstd);
    expect(decoded.vkFormat).toBe(70);
    expect([decoded.width, decoded.height]).toEqual([width, height]);
    expect(decoded.keyValues['LUMI.heightScaleM']).toBe('0.25');
    const heights = dequantizeHeights(decoded.data, Number(decoded.keyValues['LUMI.heightOffsetM']), Number(decoded.keyValues['LUMI.heightScaleM']));
    let max = 0;
    heights.forEach((h, i) => { max = Math.max(max, Math.abs(h - truth[i])); });
    expect(max).toBeLessThanOrEqual(0.125 + 1e-3);
  });

  it('rejects other formats, bad files and a missing Zstd decoder', () => {
    const r16f = encodeKtx2R16F({ levels: [{ width: 1, height: 1, data: toHalfBits([1]) }] });
    expect(() => readKtx2R16Unorm(new Uint8Array(r16f), zstd)).toThrow(/R16_UNORM/);
    expect(() => readKtx2R16Unorm(new Uint8Array(100), zstd)).toThrow(/KTX2/);
    expect(() => readKtx2R16Unorm(new Uint8Array(ktx), null)).toThrow(/Zstd/);
    expect(() => dequantizeHeights(new Uint16Array(1), 0, 0)).toThrow();
  });
});

describe('GLO-30 patch metadata and bundled assets', () => {
  const ids = HIMALAYA_PEAKS.map((p) => p.id);

  it('has one patch per summit (14, no merging), hashed file names matching the bytes on disk', () => {
    expect(Object.keys(HIMALAYA_TERRAIN_PATCHES).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const patch = getTerrainPatch(id);
      expect(patch.file).toMatch(new RegExp(`^assets/himalaya/glo30-${id}-[0-9a-f]{10}\\.ktx2$`));
      const bytes = fs.readFileSync(new URL(`../${patch.file}`, import.meta.url));
      const sha = crypto.createHash('sha256').update(bytes).digest('hex');
      expect(sha).toBe(patch.sha256);
      expect(patch.file).toContain(sha.slice(0, 10));
      expect(bytes.length).toBe(patch.bytes);
    }
    expect(getTerrainPatch('nope')).toBeNull();
    expect(GLO30_ACCESSED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stores offset, scale (0.25 m) and fill % in the KTX2 metadata, consistent with the config', () => {
    for (const id of ids) {
      const patch = getTerrainPatch(id);
      const bytes = new Uint8Array(fs.readFileSync(new URL(`../${patch.file}`, import.meta.url)));
      const decoded = readKtx2R16Unorm(bytes, zstd);
      expect(decoded.keyValues['LUMI.peakId']).toBe(id);
      expect(Number(decoded.keyValues['LUMI.heightOffsetM'])).toBe(patch.heightOffsetM);
      expect(Number(decoded.keyValues['LUMI.heightScaleM'])).toBe(0.25);
      expect(Number(decoded.keyValues['LUMI.fillPercent'])).toBe(patch.fillPercent);
      expect(Number(decoded.keyValues['LUMI.fillSummitPercent'])).toBe(patch.fillSummitPercent);
      expect(decoded.keyValues['LUMI.attribution']).toContain('Copernicus WorldDEM-30');
      expect(patch.fillPercent).toBeGreaterThanOrEqual(0);
      expect(patch.fillPercent).toBeLessThanOrEqual(100);
      expect(patch.maxQuantizationErrorM).toBeLessThanOrEqual(0.125);
      expect([decoded.width, decoded.height]).toEqual([patch.cols, patch.rows]);
      const { heights } = decodePatch(bytes, patch, zstd);
      let max = -Infinity;
      for (const h of heights) max = Math.max(max, h);
      expect(Math.abs(max - patch.maxM)).toBeLessThanOrEqual(0.125);
    }
  });

  it('keeps DEM summit values as model values close to, but distinct from, the official elevation', () => {
    for (const peak of HIMALAYA_PEAKS) {
      const patch = getTerrainPatch(peak.id);
      expect(patch.demSummitM).toBeLessThan(peak.elevationM + 50);
      expect(patch.demSummitM).toBeGreaterThan(peak.elevationM - 300);
    }
    expect(getTerrainPatch('everest').demSummitM).toBeCloseTo(8737.79, 2);
  });

  it('builds the patch grid with two LOD index sets, a skirt, and upward normals', () => {
    const meta = { rows: 5, cols: 6, latTopArcsec: 28 * 3600, lonLeftArcsec: 86 * 3600, heightOffsetM: 0, heightScaleM: 0.25 };
    const heights = new Float32Array(30).fill(5000);
    const { positions, normals, full, coarse, vertexCount } = buildPatchArrays(meta, heights, C);
    const border = 2 * (5 - 1) + 2 * (6 - 1);
    expect(vertexCount).toBe(30 + border);
    expect(full.length / 3).toBe((4 * 5) * 2 + border * 4); // skirt in both windings
    expect(strideIndices(5, 2)).toEqual([0, 2, 4]);
    expect(strideIndices(6, 2)).toEqual([0, 2, 4, 5]);
    expect(coarse.length).toBeLessThan(full.length);
    for (let i = 0; i < 30; i++) expect(normals[i * 3 + 1]).toBeGreaterThan(0.99);
    expect(positions[31 * 3 + 1]).toBeLessThan(positions[1]); // skirt vertex below the border
    // Triangles of the surface face up (+y) in scene space.
    const tri = [full[0], full[1], full[2]].map((v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
    const u = tri[1].map((v, k) => v - tri[0][k]); const w = tri[2].map((v, k) => v - tri[0][k]);
    expect(u[2] * w[0] - u[0] * w[2]).toBeGreaterThan(0);
    expect(gridIndices(6, [0, 4], [0, 5], 30, [])).toHaveLength(6);
    const corners = patchCornersXZ(getTerrainPatch('everest'), C);
    expect(corners).toHaveLength(4);
    expect(corners[0].z).toBeLessThan(corners[3].z); // NW is north of SW
    expect(corners[1].x).toBeGreaterThan(corners[0].x); // NE is east of NW
  });
});

describe('Sun position', () => {
  const everest = HIMALAYA_PEAKS.find((p) => p.id === 'everest');

  it('computes local MEAN SOLAR time from the longitude, not a civil time zone', () => {
    const date = new Date('2026-11-15T06:00:00Z');
    expect(localMeanSolarMinutes(date, 86.925)).toBeCloseTo(360 + 86.925 * 4, 6);
    expect(formatClock(localMeanSolarMinutes(date, 74.589))).toBe('10:58');
    expect(formatClock(localMeanSolarMinutes(new Date('2026-11-15T23:00:00Z'), 86.925))).toBe('04:47');
    expect(dateAtUtcMinutes(date, 610).toISOString()).toBe('2026-11-15T10:10:00.000Z');
  });

  it('gives plausible azimuth/altitude for fixed times at Everest (approximate model)', () => {
    const noonDecember = approximateSun(new Date('2026-12-21T06:12:18Z'), everest.lat, everest.lon);
    expect(noonDecember.altitudeDeg).toBeGreaterThan(37);
    expect(noonDecember.altitudeDeg).toBeLessThan(40.5);
    expect(Math.abs(noonDecember.azimuthDeg - 180)).toBeLessThan(3);
    const noonJune = approximateSun(new Date('2026-06-21T06:12:18Z'), everest.lat, everest.lon);
    expect(noonJune.altitudeDeg).toBeGreaterThan(83);
    const morning = approximateSun(new Date('2026-11-15T02:00:00Z'), everest.lat, everest.lon);
    expect(morning.azimuthDeg).toBeGreaterThan(90);
    expect(morning.azimuthDeg).toBeLessThan(150);
    const night = approximateSun(new Date('2026-12-21T18:12:18Z'), everest.lat, everest.lon);
    expect(night.altitudeDeg).toBeLessThan(-50);
    expect(noonDecember.source).toBe('approximate');
  });

  it('uses Astronomy Engine Horizon() when available and falls back to the labelled approximation', () => {
    const Astronomy = {
      Body: { Sun: 'Sun' },
      Observer: vi.fn(function Observer(lat, lon, h) { Object.assign(this, { lat, lon, h }); }),
      Equator: vi.fn(() => ({ ra: 15.2, dec: -18.4 })),
      Horizon: vi.fn(() => ({ azimuth: 171.5, altitude: 42.25 })),
    };
    const date = new Date('2026-11-15T06:00:00Z');
    const result = computeSun({ date, lat: everest.lat, lon: everest.lon, heightM: everest.elevationM, Astronomy });
    expect(result).toEqual({ azimuthDeg: 171.5, altitudeDeg: 42.25, source: 'astronomy-engine' });
    expect(Astronomy.Horizon).toHaveBeenCalledWith(date, expect.objectContaining({ lat: everest.lat, lon: everest.lon, h: everest.elevationM }), 15.2, -18.4, 'normal');
    expect(astronomySun(date, 1, 2, 3, Astronomy).source).toBe('astronomy-engine');
    const broken = { ...Astronomy, Equator: () => { throw new Error('x'); } };
    expect(computeSun({ date, lat: 28, lon: 87, Astronomy: broken }).source).toBe('approximate');
    expect(computeSun({ date, lat: 28, lon: 87 }).source).toBe('approximate');
  });

  it('turns azimuth/altitude into a scene direction through the local basis', () => {
    const basis = localBasis(C.lon, C.lat, C);
    const south = sunDirectionScene(180, 0, basis);
    expect(south.z).toBeCloseTo(1, 6);
    expect(south.y).toBeCloseTo(0, 9);
    const east = sunDirectionScene(90, 30, basis);
    expect(east.x).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(east.y).toBeCloseTo(0.5, 9);
  });
});

describe('tile LRU', () => {
  it('evicts the least recently used entry, refreshes on get, skips pinned keys and disposes on clear', () => {
    const evicted = [];
    const lru = createLru(3, (key) => evicted.push(key));
    ['a', 'b', 'c'].forEach((k) => lru.set(k, k));
    lru.get('a');
    lru.set('d', 'd');
    expect(evicted).toEqual(['b']);
    lru.set('e', 'e', { isPinned: (k) => k === 'c' });
    expect(evicted).toEqual(['b', 'a']);
    expect(lru.keys()).toEqual(['c', 'd', 'e']);
    expect(lru.delete('d')).toBe(true);
    lru.clear();
    expect(evicted).toEqual(['b', 'a', 'd', 'c', 'e']);
    expect(lru.size).toBe(0);
  });
});

function fakeElement() {
  const classes = new Set();
  const attributes = {};
  const listeners = {};
  return {
    hidden: false,
    dataset: {},
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: (name) => classes.has(name) },
    setAttribute: (name, value) => { attributes[name] = String(value); },
    getAttribute: (name) => attributes[name],
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
    click: () => listeners.click?.(),
  };
}

describe('bottom sheet below 760 px', () => {
  it('cycles collapsed -> half -> expanded -> collapsed with aria-expanded', () => {
    expect(SHEET_STATES).toEqual(['collapsed', 'half', 'expanded']);
    expect(nextSheetState('collapsed')).toBe('half');
    expect(nextSheetState('half')).toBe('expanded');
    expect(nextSheetState('expanded')).toBe('collapsed');
    expect(sheetAriaExpanded('collapsed')).toBe('false');
    expect(sheetAriaExpanded('half')).toBe('true');
  });

  it('drives classes and aria-expanded on the toggle, reveals on selection, and hides itself on wide screens', () => {
    const panel = fakeElement(); const toggle = fakeElement();
    const media = { matches: true, listener: null, addEventListener(_, fn) { this.listener = fn; }, removeEventListener() { this.listener = null; } };
    const sheet = createBottomSheet({ panel, toggle, media });
    expect(sheet.state).toBe('collapsed');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.classList.contains('is-sheet')).toBe(true);
    expect(panel.classList.contains('is-collapsed')).toBe(true);
    toggle.click();
    expect(sheet.state).toBe('half');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.classList.contains('is-half')).toBe(true);
    toggle.click();
    expect(panel.classList.contains('is-expanded')).toBe(true);
    sheet.reveal();
    expect(sheet.state).toBe('expanded'); // reveal never collapses
    sheet.setState('collapsed');
    sheet.reveal();
    expect(sheet.state).toBe('half');
    media.matches = false; media.listener();
    expect(toggle.hidden).toBe(true);
    expect(panel.classList.contains('is-sheet')).toBe(false);
    sheet.dispose();
    expect(media.listener).toBeNull();
  });
});

describe('provenance wording', () => {
  const date = new Date('2026-11-15T06:10:00Z');

  it('composes exactly the proposed bar', () => {
    expect(composeProvenanceBar({ terrainMode: 'glo30', sun: { source: 'astronomy-engine' }, date })).toBe(
      `Peaks: reference list (sources cited) | Terrain: Copernicus GLO-30 (reconstructed), 1 arc-second, accessed ${GLO30_ACCESSED} | Overview: Terrarium / AWS Terrain Tiles (reconstructed) | Sun: astronomy-engine (physical-model), 2026-11-15 06:10 UTC`,
    );
    expect(composeProvenanceBar({ terrainMode: 'terrarium', sun: { source: 'approximate' }, date })).toContain('Terrain: Terrarium / AWS Terrain Tiles (reconstructed) |');
    expect(composeProvenanceBar({ terrainMode: 'terrarium', sun: { source: 'approximate' }, date })).toContain('Sun: approximate model');
    expect(TERRAIN_LABELS.glo30).toContain('(reconstructed)');
  });

  it('shows the DEM elevation apart from the official one, and the GLO-30 fill share', () => {
    const everest = getTerrainPatch('everest');
    expect(demElevationText(8737.79, 'x')).toBe('DEM elevation (model): 8,738 m — DEM ≠ survey (x)');
    expect(demRowText('glo30', everest, null)).toMatch(/^DEM elevation \(model\): 8,738 m — DEM ≠ survey \(Copernicus GLO-30/);
    expect(demRowText('terrarium', everest, { z: 9, valueM: 8704, window: '3x3 pixels around the summit' })).toContain('Terrarium z9');
    expect(demRowText('terrarium', everest, null)).toBeNull();
    expect(glo30FillNote(everest)).toMatch(/^GLO-30 2021: [\d.]+% of this patch filled from other sources \(within 1 km of the summit: [\d.]+%/);
    expect(terrainRowText('glo30', everest, 'ready')).toContain('Copernicus GLO-30 (reconstructed), 1 arc-second');
    expect(terrainRowText('glo30', everest, 'error')).toContain('unavailable');
    expect(terrainRowText('terrarium', everest, null)).toContain('Terrarium');
    expect(FUTURE_FIELDS).toEqual([]);
  });

  it('lists the exact attributions (Copernicus official notice, joerd/USGS/NOAA/Mapzen)', () => {
    const byId = Object.fromEntries(ATTRIBUTIONS.map((a) => [a.id, a]));
    expect(byId.glo30.text).toBe('produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved');
    for (const part of ['Mapzen', 'GMTED2010', 'SRTM', 'U.S. Geological Survey', 'ETOPO1', 'National Oceanic and Atmospheric Administration']) {
      expect(byId.terrarium.text).toContain(part);
    }
  });
});

describe('registry and service-worker rules', () => {
  it('declares the new sources as reconstructed and the Sun as a physical model for Himalaya', () => {
    expect(SOURCE_DEFINITIONS.himalayaTerrainGlo30.provenance).toBe('reconstructed');
    expect(SOURCE_DEFINITIONS.terrariumTiles.provenance).toBe('reconstructed');
    expect(SOURCE_DEFINITIONS.astronomy.observatories).toContain('living-himalaya');
    expect(SOURCE_DEFINITIONS.himalayaTerrainGlo30.license).toContain('Copernicus WorldDEM-30');
  });

  it('caches Terrarium in lea-terrain-v1 (100 MB) and the hashed patches cache-first', () => {
    const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    expect(sw).toContain("const TERRAIN_CACHE = 'lea-terrain-v1';");
    expect(sw).toContain('const TERRAIN_CACHE_LIMIT_BYTES = 100 * 1024 * 1024;');
    const source = sw.match(/isHashedHimalayaPatch\(url\) \{\s*return [^/]+\/(.+)\/\.test/)[1];
    const pattern = new RegExp(source);
    for (const patch of Object.values(HIMALAYA_TERRAIN_PATCHES)) expect(pattern.test(`/${patch.file}`)).toBe(true);
    expect(pattern.test('/assets/himalaya/glo30-everest.ktx2')).toBe(false);
  });
});
