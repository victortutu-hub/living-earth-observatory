// Himalaya LOT 7 — 6 selected Nepal peaks beside the 14 eight-thousanders:
// frozen lists, focus for all 20, Yalung Kang on the Kangchenjunga patch,
// History "Not available" (no Himalayan Database data for the 6), two marker
// styles on Earth, grouped summit list.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HIMALAYA_ALL_PEAKS, HIMALAYA_ALL_PEAK_IDS, HIMALAYA_PEAKS, HIMALAYA_PEAK_IDS, HIMALAYA_SELECTED_PEAKS,
  HIMALAYA_SELECTED_PEAK_IDS, PEAK_GROUPS, getHimalayaPeak, isSelectedPeak,
} from '../src/config/himalaya-peaks.js';
import {
  GLO30_ACCESSED, GLO30_SELECTED_ACCESSED, HIMALAYA_SELECTED_TERRAIN_PATCHES, HIMALAYA_SHARED_PATCH_POINTS,
  HIMALAYA_TERRAIN_PATCHES, getTerrainPatch, patchKeyOf,
} from '../src/config/himalaya-terrain-patches.js';
import { HIMALAYA_HISTORY_COVERAGE } from '../src/config/himalaya-history.js';
import { NOT_AVAILABLE, NOT_COVERED, historyRows, isCovered } from '../src/himalaya/hdb-history.js';
import { peakListGroups, resolveInitialFocus } from '../src/himalaya/himalaya-app.js';
import { createLivingHimalayaAtlasModule } from '../src/himalaya/living-himalaya-atlas-module.js';
import { HIMALAYA_PEAKS_COUNT_LABEL, MARKER_STYLES, himalayaPeaksPlugin } from '../src/earth/layers/himalaya-peaks.js';
import { readKtx2R16Unorm } from '../src/himalaya/ktx2-r16-reader.js';
import { decodePatch } from '../src/himalaya/patch-grid.js';
import { ATTRIBUTIONS, composeProvenanceBar, glo30Label } from '../src/himalaya/himalaya-provenance.js';
import { interpolateAtHeight } from '../src/himalaya/summit-weather.js';
import { utmZone } from '../src/himalaya/utm.js';
import { patchOutline } from '../src/himalaya/sentinel-client.js';

const zstd = { decode: (data) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) };
const SELECTED = ['ama-dablam', 'annapurna-2', 'langtang-lirung', 'nuptse', 'pumori', 'yalung-kang'];

describe('lists: 14 frozen, 6 selected, 20 combined', () => {
  it('keeps the 14 eight-thousanders unchanged and adds 6 selected Nepal peaks', () => {
    expect(HIMALAYA_PEAKS).toHaveLength(14);
    expect(HIMALAYA_PEAK_IDS).toHaveLength(14);
    expect(HIMALAYA_PEAKS.every((p) => p.group === 'eight-thousanders' && p.elevationM > 8000)).toBe(true);
    expect(HIMALAYA_SELECTED_PEAK_IDS).toEqual(SELECTED);
    expect(Object.isFrozen(HIMALAYA_SELECTED_PEAKS)).toBe(true);
    expect(HIMALAYA_SELECTED_PEAKS.every((p) => Object.isFrozen(p) && Object.isFrozen(p.coordinates) && p.group === 'selected-nepal')).toBe(true);
    expect(HIMALAYA_ALL_PEAKS).toHaveLength(20);
    expect(HIMALAYA_ALL_PEAK_IDS).toEqual([...HIMALAYA_PEAK_IDS, ...SELECTED]);
    expect(new Set(HIMALAYA_ALL_PEAK_IDS).size).toBe(20);
    expect(PEAK_GROUPS).toEqual({ 'eight-thousanders': 'The 14 eight-thousanders', 'selected-nepal': 'Selected Nepal peaks' });
    expect(SELECTED.every(isSelectedPeak)).toBe(true);
    expect(isSelectedPeak('everest')).toBe(false);
  });

  it('uses the OSM node for all 6, with the arbitrations and elevations as decided', () => {
    const osm = Object.fromEntries(HIMALAYA_SELECTED_PEAKS.map((p) => [p.id, p.coordinates.osm]));
    expect(osm).toEqual({
      'ama-dablam': 'node/477904058', 'annapurna-2': 'node/3588473785', 'langtang-lirung': 'node/3426381138',
      nuptse: 'node/3696097628', pumori: 'node/2677892533', 'yalung-kang': 'node/11867698454',
    });
    for (const p of HIMALAYA_SELECTED_PEAKS) {
      expect(p.coordinates.chosen).toBe('osm');
      expect(p.lat).toBeGreaterThan(27.5); expect(p.lat).toBeLessThan(28.8);
      expect(p.lon).toBeGreaterThan(83.9); expect(p.lon).toBeLessThan(88.3);
      if (p.coordinates.differenceM > 150) expect(p.note, p.id).toMatch(/OSM chosen|GLO-30/);
    }
    const elev = (id) => getHimalayaPeak(id).elevationM;
    expect([elev('ama-dablam'), elev('annapurna-2'), elev('langtang-lirung'), elev('nuptse'), elev('pumori'), elev('yalung-kang')]).toEqual([6814, 7937, 7227, 7861, 7161, 8505]);
    expect(getHimalayaPeak('ama-dablam').alternateElevations).toEqual([{ elevationM: 6812, source: 'commonly cited, source not verified' }]);
    expect(getHimalayaPeak('nuptse').alternateElevations[0].elevationM).toBe(7864);
    expect(getHimalayaPeak('nuptse').note).toMatch(/Nuptse I/);
    expect(getHimalayaPeak('pumori').alternateElevations[0].elevationM).toBe(7138);
    expect(getHimalayaPeak('yalung-kang').note).toMatch(/^Subsidiary summit of Kangchenjunga \(Kangchenjunga West\)/);
  });
});

describe('focus is valid for all 20 peaks', () => {
  const atlas = createLivingHimalayaAtlasModule();
  it.each(HIMALAYA_ALL_PEAK_IDS)('%s', (id) => {
    expect(atlas.acceptsFocus(id)).toBe(true);
    expect(resolveInitialFocus(`?focus=${id}`)).toBe(id);
    expect(getHimalayaPeak(id)?.id).toBe(id);
  });
  it('still rejects unknown ids', () => {
    expect(atlas.acceptsFocus('nope')).toBe(false);
    expect(resolveInitialFocus('?focus=kangchenjunga-west')).toBeNull();
  });
});

describe('terrain patches', () => {
  it('keeps the 14 patch keys; 5 selected peaks have their own patch, hashed, accessed 2026-11-16', () => {
    expect(Object.keys(HIMALAYA_TERRAIN_PATCHES).sort()).toEqual([...HIMALAYA_PEAK_IDS].sort());
    expect(Object.keys(HIMALAYA_SELECTED_TERRAIN_PATCHES)).toEqual(['ama-dablam', 'annapurna-2', 'langtang-lirung', 'nuptse', 'pumori']);
    expect(GLO30_ACCESSED).toBe('2026-11-15');
    expect(GLO30_SELECTED_ACCESSED).toBe('2026-11-16');
    for (const [id, patch] of Object.entries(HIMALAYA_SELECTED_TERRAIN_PATCHES)) {
      expect(patch.file).toMatch(new RegExp(`^assets/himalaya/glo30-${id}-[0-9a-f]{10}\\.ktx2$`));
      const bytes = fs.readFileSync(new URL(`../${patch.file}`, import.meta.url));
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(patch.sha256);
      expect(bytes.length).toBe(patch.bytes);
      expect(patch.accessed).toBe('2026-11-16');
      const decoded = readKtx2R16Unorm(new Uint8Array(bytes), zstd);
      expect(decoded.keyValues['LUMI.peakId']).toBe(id);
      expect(decoded.keyValues['LUMI.source']).toContain('accessed 2026-11-16');
      expect([decoded.width, decoded.height]).toEqual([patch.cols, patch.rows]);
      const peak = getHimalayaPeak(id);
      expect(patch.demSummitM).toBeLessThan(peak.elevationM + 50);
      expect(patch.demSummitM).toBeGreaterThan(peak.elevationM - 200); // Ama Dablam: 6661 m (DEM) vs 6814 m
      expect(patchKeyOf(id)).toBe(id);
    }
  });

  it('Yalung Kang uses the Kangchenjunga patch, with DEM and fill computed on its own point', () => {
    const kang = getTerrainPatch('kangchenjunga');
    const yalung = getTerrainPatch('yalung-kang');
    expect(Object.keys(HIMALAYA_SHARED_PATCH_POINTS)).toEqual(['yalung-kang']);
    expect(yalung.patchOf).toBe('kangchenjunga');
    expect(patchKeyOf('yalung-kang')).toBe('kangchenjunga');
    expect(yalung.file).toBe(kang.file);
    expect(yalung.sha256).toBe(kang.sha256);
    expect(yalung.accessed).toBeUndefined(); // the shared patch's access date applies
    expect(yalung.demSummitM).toBeCloseTo(8461.79, 2);
    expect(yalung.demSummitM).not.toBe(kang.demSummitM);
    expect(yalung.fillSummitPercent).toBe(89.8);
    const [lat, lon] = yalung.demSummitAt;
    const peak = getHimalayaPeak('yalung-kang');
    expect(Math.hypot((lat - peak.lat) * 111320, (lon - peak.lon) * 111320 * Math.cos((lat * Math.PI) / 180))).toBeLessThanOrEqual(150);
    // Inside the Kangchenjunga patch grid, and the decoded height there matches.
    const r = Math.round(kang.latTopArcsec - lat * 3600); const c = Math.round(lon * 3600 - kang.lonLeftArcsec);
    expect(r).toBeGreaterThan(0); expect(r).toBeLessThan(kang.rows); expect(c).toBeGreaterThan(0); expect(c).toBeLessThan(kang.cols);
    const { heights } = decodePatch(new Uint8Array(fs.readFileSync(new URL(`../${kang.file}`, import.meta.url))), kang, zstd);
    expect(Math.abs(heights[r * kang.cols + c] - yalung.demSummitM)).toBeLessThanOrEqual(0.125);
    expect(getTerrainPatch('yalung-kang')).toBe(yalung); // one frozen merged object
    expect(Object.isFrozen(yalung)).toBe(true);
  });
});

describe('History: "Not available" for the 6 vs "Not covered" for the uncovered 14', () => {
  it('shows no Himalayan Database data or code for the selected peaks', () => {
    for (const id of SELECTED) {
      expect(isCovered(id)).toBe(false);
      expect(Object.hasOwn(HIMALAYA_HISTORY_COVERAGE, id)).toBe(false);
      expect(historyRows(id, { peaks: { [id]: { covered: true, totals: {} } }, source: {} })).toEqual([['History', NOT_AVAILABLE, 'pending']]);
    }
    expect(NOT_AVAILABLE).toBe('Not available for this peak');
    expect(historyRows('k2', null)).toEqual([['History', NOT_COVERED, 'pending']]);
    expect(NOT_AVAILABLE).not.toBe(NOT_COVERED);
    const asset = JSON.parse(fs.readFileSync(new URL('../assets/himalaya/hdb-aggregates-53d5c51b56.json', import.meta.url), 'utf8'));
    for (const id of SELECTED) expect(Object.hasOwn(asset.peaks, id)).toBe(false);
    expect(Object.keys(HIMALAYA_HISTORY_COVERAGE)).toHaveLength(14);
    expect(ATTRIBUTIONS.find((a) => a.id === 'himalayanDatabase').note).toMatch(/Not available for this peak.*14 eight-thousanders only/);
  });
});

describe('Earth layer: one layer, two marker styles', () => {
  it('carries 14 + 6 points in two styles and labels the count', async () => {
    const items = himalayaPeaksPlugin.normalize(await himalayaPeaksPlugin.fetch());
    expect(himalayaPeaksPlugin.label).toBe('Himalaya peaks');
    expect(HIMALAYA_PEAKS_COUNT_LABEL).toBe('14 eight-thousanders + 6 selected peaks');
    expect(himalayaPeaksPlugin.countLabel(20)).toBe('14 eight-thousanders + 6 selected peaks');
    const big = items.filter((i) => i.group === 'eight-thousanders');
    const small = items.filter((i) => i.group === 'selected-nepal');
    expect([big.length, small.length]).toEqual([14, 6]);
    expect(big.every((i) => i.size === MARKER_STYLES['eight-thousanders'].size && i.color === MARKER_STYLES['eight-thousanders'].color)).toBe(true);
    expect(small.every((i) => i.size === MARKER_STYLES['selected-nepal'].size && i.color === MARKER_STYLES['selected-nepal'].color)).toBe(true);
    expect(MARKER_STYLES['selected-nepal'].size).toBeLessThan(MARKER_STYLES['eight-thousanders'].size);
    expect(MARKER_STYLES['selected-nepal'].color).not.toBe(MARKER_STYLES['eight-thousanders'].color);
    expect(small.find((i) => /Yalung Kang/.test(i.title)).detail.find((l) => l.label === 'Group').value).toBe('Selected Nepal peaks');
  });
});

describe('UI list, provenance and data paths for the new peaks', () => {
  it('lists two titled groups: 14 then 6', () => {
    const groups = peakListGroups();
    expect(groups.map((g) => [g.title, g.peaks.length])).toEqual([['The 14 eight-thousanders', 14], ['Selected Nepal peaks', 6]]);
  });

  it('names the access date of the patch shown', () => {
    expect(glo30Label()).toBe(`Copernicus GLO-30 (reconstructed), 1 arc-second, accessed ${GLO30_ACCESSED}`);
    expect(composeProvenanceBar({ glo30Accessed: '2026-11-16', date: new Date('2026-11-16T06:00:00Z') })).toContain('accessed 2026-11-16 |');
    expect(composeProvenanceBar({ terrainMode: 'terrarium', glo30Accessed: '2026-11-16' })).toContain('Terrain: Terrarium / AWS Terrain Tiles (reconstructed) |');
  });

  it('Ama Dablam falls between 500 and 400 hPa (no new levels), Yalung Kang between 350 and 300 hPa', () => {
    const levels = [[500, 5800], [400, 7500], [350, 8400], [300, 9600]].map(([p, h]) => ({
      pressureHpa: p, heightM: h, temperatureC: -20, relativeHumidityPct: 50, cloudCoverPct: 0, windSpeedKmh: 40, windDirectionDeg: 270,
    })).sort((a, b) => a.heightM - b.heightM);
    expect(interpolateAtHeight(levels, getHimalayaPeak('ama-dablam').elevationM)).toMatchObject({ status: 'interpolated', lowerHpa: 500, upperHpa: 400 });
    expect(interpolateAtHeight(levels, getHimalayaPeak('yalung-kang').elevationM)).toMatchObject({ status: 'interpolated', lowerHpa: 350, upperHpa: 300 });
  });

  it('Sentinel-2: every new patch lies in UTM zone 45 (Annapurna II next to 84°E included)', () => {
    for (const id of SELECTED) {
      const outline = patchOutline(getTerrainPatch(id));
      expect(utmZone(getHimalayaPeak(id).lon), id).toBe(45);
      expect(outline.ring).toHaveLength(5);
    }
    const ring = patchOutline(getTerrainPatch('annapurna-2')).ring;
    expect(Math.min(...ring.map(([lon]) => lon))).toBeGreaterThan(84); // the whole patch east of the zone boundary
  });
});
