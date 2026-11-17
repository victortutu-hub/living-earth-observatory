// LOT 17 — finishing lot: Lhotse route line, camp labels (terrain occlusion,
// safe area, overlap), Wikidata elevations without a source, removal of
// debugOverviewClip, Earth historical-time capability, Himalaya criterion 9.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HIMALAYA_ROUTES_ASSET } from '../src/config/himalaya-routes.js';
import { HIMALAYA_ALL_PEAKS } from '../src/config/himalaya-peaks.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import {
  CAPABILITY_DEFINITIONS, OBSERVATORY_CAPABILITIES, OBSERVATORY_CAPABILITY_EVIDENCE, OBSERVATORY_CAPABILITY_LIMITS,
} from '../src/config/capability-registry.js';
import { validateObservatoryRegistry } from '../src/core/observatory/module-contract.js';
import { platformRegistry } from '../src/core/platform-registry.js';
import { EARTH_TIME_CAPABILITIES } from '../src/earth/temporal-provenance.js';
import { TEXT, campDisplay, campRow, routeSectionRows, validateRoutesAsset } from '../src/himalaya/routes-model.js';
import zlib from 'node:zlib';
import { getTerrainPatch } from '../src/config/himalaya-terrain-patches.js';
import { HIMALAYA_REGION_CENTER } from '../src/config/himalaya-peaks.js';
import { decodePatch, buildPatchArrays } from '../src/himalaya/patch-grid.js';
import { projectLonLat, heightKm } from '../src/himalaya/projection.js';
import { patchHeightKmAt, terrainOccludes } from '../src/himalaya/label-occlusion.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const asset = JSON.parse(read(HIMALAYA_ROUTES_ASSET.file));
const camp = (peakId, id) => asset.peaks[peakId].camps.find((c) => c.id === id);

describe('LOT 17: Lhotse route line', () => {
  const lhotse = asset.peaks.lhotse.routes[0];
  const everest = asset.peaks.everest.routes.find((r) => r.id === 'south-col');

  it('is the Everest South Col route from BC to C3 (same waypoints), interpretive, with the C4 note', () => {
    expect(asset.peaks.lhotse.routes).toHaveLength(1);
    expect(lhotse.provenance).toBe('interpretive');
    expect(lhotse.note).toBe('Route continues up the Lhotse Face to C4 (~7,850 m, position not published).');
    expect(lhotse.waypoints.length).toBeLessThan(everest.waypoints.length);
    lhotse.waypoints.forEach(([lat, lon, dem], k) => {
      const [eLat, eLon, eDem] = everest.waypoints[k];
      expect(lat).toBe(eLat);
      expect(lon).toBe(eLon);
      expect(Math.abs(dem - eDem)).toBeLessThanOrEqual(0.25); // same GLO-30 samples, different patch quantisation offset
    });
  });

  it('stops at C3 (no point towards the unpublished C4)', () => {
    const c3 = camp('lhotse', 'lhotse-c3');
    const [lat, lon] = lhotse.waypoints.at(-1);
    expect([lat, lon]).toEqual([+c3.lat.toFixed(6), +c3.lon.toFixed(6)]);
    expect(lhotse.via.map((v) => v.label)).toEqual(['BC', 'Khumbu Icefall', 'C1', 'C2', 'C3']);
    expect(camp('lhotse', 'lhotse-c4')).toMatchObject({ lat: null, marker: false });
    const rows = Object.fromEntries(routeSectionRows({ peakId: 'lhotse', data: asset, status: 'ready', showRoutes: true, showCamps: false }).map(([k, v]) => [k, v]));
    expect(rows['Route · Nepal (south)']).toContain('Route continues up the Lhotse Face to C4 (~7,850 m, position not published).');
  });
});

describe('LOT 17: Wikidata elevations without a reference', () => {
  it('Everest S BC: no other published value -> "Wikidata elevation (source unknown)", never flagged', () => {
    const bc = camp('everest', 'everest-s-bc');
    expect(bc).toMatchObject({ reportedElevationM: 5364, elevationSource: 'wikidata:Q99671286', elevationSourceUnknown: true, flag: false, marker: true });
    expect(campRow(bc, asset.references)[1].startsWith('Wikidata elevation (source unknown) 5,364 m')).toBe(true);
    expect(TEXT.sourceUnknown).toBe('Wikidata elevation (source unknown)');
  });

  it('South Col and K2 BC: the published value becomes the main one; Wikidata stays in sources, outside the range', () => {
    const col = camp('everest', 'everest-s-c4');
    expect(col).toMatchObject({ reportedElevationM: 8000, elevationSource: 'arnette-everest', reportedRangeM: [8000, 8016], demDeltaM: 136, flag: true, marker: true });
    expect(col.sources.find((s) => s.ref === 'wikidata:Q2598195' && s.role === 'position')).toBeTruthy(); // the position stays Wikidata
    expect(col.sources.find((s) => s.ref === 'wikidata:Q2598195' && s.role === 'reference')).toMatchObject({ value: 7906, sourceUnknown: true });
    // K2 BC: the Gatta page answered 404 (17 Nov 2026) -> 5000 m stays in the range only; Wikidata 4965 m is the main value, source unknown.
    const k2 = camp('k2', 'k2-bc');
    expect(k2).toMatchObject({ reportedElevationM: 4965, elevationSource: 'wikidata:Q88267655', elevationSourceUnknown: true, demDeltaM: 4, flag: false, marker: true, reportedRangeM: [4965, 5000] });
    expect(k2.sources.find((s) => s.ref === 'gatta-k2')).toMatchObject({ role: 'reference', value: 5000 });
    expect(campRow(k2, asset.references)[1].startsWith('Wikidata elevation (source unknown) 4,965 m')).toBe(true);
    expect(asset.references['arnette-everest'].evidence).toBe('page');
    expect(asset.references['arnette-everest'].checked).toContain('the South Col at 8000m');
  });

  it('no main elevation may come from a search-result summary (validator)', () => {
    const peakIds = HIMALAYA_ALL_PEAKS.map((p) => p.id);
    expect(validateRoutesAsset(asset, { peakIds })).toEqual([]);
    for (const peak of Object.values(asset.peaks)) for (const c of peak.camps) expect(asset.references[c.elevationSource]?.evidence, c.id).not.toBe('search-result');
    const bad = JSON.parse(JSON.stringify(asset));
    bad.peaks.k2.camps.find((c) => c.id === 'k2-bc').elevationSource = 'gatta-k2';
    expect(validateRoutesAsset(bad, { peakIds }).join(' ')).toMatch(/main elevation from a search-result summary/);
  });

  it('an elevation without a source is never flagged; the validator enforces it', () => {
    expect(campDisplay({ hasPosition: true, outsidePatch: false, demDeltaM: 120, sourceUnknown: true })).toEqual({ marker: true, listOnly: null, flag: false });
    const bad = JSON.parse(JSON.stringify(asset));
    bad.peaks.everest.camps.find((c) => c.id === 'everest-s-bc').flag = true;
    expect(validateRoutesAsset(bad, { peakIds: HIMALAYA_ALL_PEAKS.map((p) => p.id) }).join(' ')).toMatch(/unverified elevation flagged/);
  });
});

describe('LOT 17: camp labels and debug code', () => {
  it('camp labels: terrain occlusion, safe area and overlap, checked every 250 ms (peak labels unchanged)', () => {
    const scene = read('src/himalaya/himalaya-scene.js');
    expect(scene).toContain('const LABEL_CHECK_MS = 250;');
    expect(scene).toContain("import { terrainOccludes } from './label-occlusion.js';");
    expect(scene).toContain("camp.labelReason = 'terrain'");
    expect(scene).toContain("camp.labelReason = 'safe-area'");
    expect(scene).toContain("camp.labelReason = 'overlap'");
    expect(scene).toContain('camp.labelObject.visible = near && camp.labelReason === null;');
    expect(scene).toContain('if (marker.selectedStyle) marker.labelObject.visible = marker.peak.id === activeId || d <= SELECTED_LABEL_MAX_KM;');
    expect(read('src/himalaya/himalaya-app.js')).toContain('scene.setLabelSafeArea?.({ top, bottom });');
  });

  it('debugOverviewClip is gone (code, debug hook, page)', () => {
    for (const f of ['src/himalaya/himalaya-scene.js', 'src/himalaya/himalaya-app.js', 'living-himalaya.html']) {
      expect(read(f), f).not.toMatch(/debugOverviewClip|clipDebugOff/);
    }
  });
});

describe('LOT 17: terrain occlusion on the real Everest GLO-30 patch', () => {
  const meta = getTerrainPatch('everest');
  const zstd = { decode: (d) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(d.buffer, d.byteOffset, d.byteLength))) };
  const { heights } = decodePatch(new Uint8Array(fs.readFileSync(new URL(`../${meta.file}`, import.meta.url))), meta, zstd);
  const grid = { positions: buildPatchArrays(meta, heights, HIMALAYA_REGION_CENTER).positions, meta, center: HIMALAYA_REGION_CENTER };
  const at = (c) => { const p = projectLonLat(c.lon, c.lat, HIMALAYA_REGION_CENTER); return { x: p.x, y: heightKm(c.demElevationM + 10), z: p.z }; };

  it('heights on the grid match the camp GLO-30 values', () => {
    for (const c of asset.peaks.everest.camps.filter((x) => x.marker)) {
      const p = at(c);
      expect(Math.abs(patchHeightKmAt(grid, p.x, p.z) * 1000 - c.demElevationM)).toBeLessThan(0.2);
    }
  });

  it('a camp is visible from straight above and hidden from a low camera behind a ridge', () => {
    const c2 = at(camp('everest', 'everest-s-c2'));
    expect(terrainOccludes(grid, c2, { x: c2.x + 0.01, y: c2.y + 8, z: c2.z })).toBe(false);
    // C2 (Western Cwm) seen from the Tibetan side, 5 km north-east at C2 height: the Everest–Lhotse massif is in between.
    expect(terrainOccludes(grid, c2, { x: c2.x + 4, y: c2.y + 0.2, z: c2.z - 6 })).toBe(true);
    // a horizontal line of sight east from the Western Cwm runs into the Lhotse-Everest wall
    expect(terrainOccludes(grid, c2, { x: c2.x + 40, y: c2.y, z: c2.z })).toBe(true);
    // outside the patch there is no terrain data (the march stops: not hidden)
    expect(patchHeightKmAt(grid, c2.x + 40, c2.z)).toBeNull();
  });
});

describe('LOT 17: Living Earth historical time', () => {
  const limits = OBSERVATORY_CAPABILITY_LIMITS['living-earth']['historical-time'];

  it('Earth declares historical-time with its real limits (no evidence map)', () => {
    expect(OBSERVATORY_CAPABILITIES['living-earth']).toContain('historical-time');
    expect(OBSERVATORY_CAPABILITY_EVIDENCE['living-earth']).toBeUndefined();
    expect(platformRegistry.getCapabilityLimits('living-earth', 'historical-time')).toBe(limits);
    expect(read('earth-eonet-relief.html')).toMatch(/id="timeScrubSlider" type="range" min="0" max="365"/);
    expect(limits).toContain('365 days back');
    expect(EARTH_TIME_CAPABILITIES.firms.range.start).toBe('2000-11-01');
    expect(limits).toContain('NASA FIRMS (from 1 Nov 2000');
    expect(EARTH_TIME_CAPABILITIES.snowIce.range.start).toBe('2000-02-24');
    expect(limits).toContain('from 24 Feb 2000');
    expect(EARTH_TIME_CAPABILITIES.oceanCurrents.range.start).toBe('2022-01-01');
    expect(limits).toContain('SMOC, from 2022');
    expect(EARTH_TIME_CAPABILITIES.wind.lagDays).toBe(6);
    for (const key of ['gdacs', 'aurora', 'dailyClouds', 'iss', 'gvp']) expect(EARTH_TIME_CAPABILITIES[key].kind).toBe('live-only');
    for (const name of ['GDACS', 'aurora (OVATION)', 'daily clouds', 'the ISS', 'GVP volcano catalogue']) expect(limits).toContain(name);
  });

  it('the contract rejects limits for an undeclared capability', () => {
    const options = {
      taxonomy: PLATFORM_TAXONOMY, sourceDefinitions: SOURCE_DEFINITIONS, capabilityDefinitions: CAPABILITY_DEFINITIONS,
      observatoryCapabilities: OBSERVATORY_CAPABILITIES, observatoryCapabilityEvidence: OBSERVATORY_CAPABILITY_EVIDENCE,
    };
    expect(validateObservatoryRegistry(OBSERVATORY_REGISTRY, { ...options, observatoryCapabilityLimits: OBSERVATORY_CAPABILITY_LIMITS }).errors).toEqual([]);
    const codes = validateObservatoryRegistry(OBSERVATORY_REGISTRY, { ...options, observatoryCapabilityLimits: { 'living-protein': { 'historical-time': 'x' } } }).errors.map((e) => e.code);
    expect(codes).toContain('limits-without-capability');
  });
});

describe('LOT 17: Himalaya criterion 9 and next threshold', () => {
  it('finishing lot done -> 9 of 11 = 82%; next threshold = the real night sky', () => {
    const himalaya = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya');
    expect(himalaya.roadmap.criteria.find((c) => c.id === 'finishing-lot').done).toBe(true);
    expect(himalaya.roadmap.progress).toBe(82);
    expect(himalaya.roadmap.next).toBe('Real night sky from NASA SVS star maps (Lot 15b)');
  });
});
