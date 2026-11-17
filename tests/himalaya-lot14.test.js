// Himalaya LOT 14 — classic routes (interpretive) and camps (reported
// positions), opt-in. Checks the built asset against the frozen config, the
// shipped GLO-30 patches and the approved scope; the pure UI texts; and that
// nothing is requested while both switches are off.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HIMALAYA_ROUTES_ASSET, HIMALAYA_ROUTE_PEAK_IDS } from '../src/config/himalaya-routes.js';
import { HIMALAYA_ALL_PEAKS } from '../src/config/himalaya-peaks.js';
import { getTerrainPatch } from '../src/config/himalaya-terrain-patches.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import { decodePatch } from '../src/himalaya/patch-grid.js';
import { composeProvenanceBar } from '../src/himalaya/himalaya-provenance.js';
import {
  CAMPS_ONLY_PEAKS, FLAG_DELTA_M, MARKER_MAX_DELTA_M, ROUTES_ATTRIBUTION, ROUTE_LINE_PEAKS, TEXT,
  campDisplay, campLabel, campRow, feetToMetres, routeSectionRows, routesBarSegment, switchNote, validateRoutesAsset, wantsRouteData,
} from '../src/himalaya/routes-model.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const assetBytes = read(HIMALAYA_ROUTES_ASSET.file);
const asset = JSON.parse(assetBytes.toString('utf8'));
const peakIds = HIMALAYA_ALL_PEAKS.map((p) => p.id);
const zstd = { decode: (d) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(d.buffer, d.byteOffset, d.byteLength))) };
function inPatch(peakId, lat, lon) {
  const meta = getTerrainPatch(peakId);
  const fj = meta.latTopArcsec - lat * 3600; const fi = lon * 3600 - meta.lonLeftArcsec;
  return fj >= 0 && fi >= 0 && fj <= meta.rows - 1 && fi <= meta.cols - 1;
}
function demAt(peakId, lat, lon) {
  const meta = getTerrainPatch(peakId);
  const { heights } = decodePatch(new Uint8Array(read(meta.file)), meta, zstd);
  const fj = meta.latTopArcsec - lat * 3600; const fi = lon * 3600 - meta.lonLeftArcsec;
  const j = Math.floor(fj); const i = Math.floor(fi); const v = fj - j; const u = fi - i;
  const g = (jj, ii) => heights[jj * meta.cols + ii];
  return (1 - v) * ((1 - u) * g(j, i) + u * g(j, i + 1)) + v * ((1 - u) * g(j + 1, i) + u * g(j + 1, i + 1));
}
const camp = (peakId, id) => asset.peaks[peakId].camps.find((c) => c.id === id);

describe('LOT 14 asset: frozen, valid, inside the approved scope', () => {
  it('matches the generated config (file, sha256, bytes) and the hand-written source', () => {
    expect(HIMALAYA_ROUTES_ASSET.file).toMatch(/^assets\/himalaya\/routes-[0-9a-f]{10}\.json$/);
    expect(crypto.createHash('sha256').update(assetBytes).digest('hex')).toBe(HIMALAYA_ROUTES_ASSET.sha256);
    expect(assetBytes.length).toBe(HIMALAYA_ROUTES_ASSET.bytes);
    expect(HIMALAYA_ROUTES_ASSET.file).toContain(HIMALAYA_ROUTES_ASSET.sha256.slice(0, 10));
    expect(crypto.createHash('sha256').update(read('tools/data/himalaya-routes-source.json')).digest('hex')).toBe(asset.sourceSha256);
    expect(HIMALAYA_ROUTE_PEAK_IDS).toEqual(Object.keys(asset.peaks));
  });

  it('passes the schema/scope validator with the real patch bounds', () => {
    expect(validateRoutesAsset(asset, { peakIds, inPatch })).toEqual([]);
  });

  it('declares the licence and attributions (ODbL file, © OpenStreetMap contributors, Wikidata CC0)', () => {
    expect(asset.license).toMatchObject({ osm: 'ODbL-1.0', wikidata: 'CC0-1.0' });
    expect(asset.attribution.join(' ')).toContain('© OpenStreetMap contributors');
    expect(asset.attribution.join(' ')).toContain('https://www.openstreetmap.org/copyright');
    expect(asset.attribution).toContain('Wikidata (CC0)');
  });

  it('route lines only for Everest; K2, Manaslu, Ama Dablam and Lhotse have camps but no routes', () => {
    expect(Object.keys(asset.peaks).sort()).toEqual([...ROUTE_LINE_PEAKS, ...CAMPS_ONLY_PEAKS].sort());
    expect(asset.peaks.everest.routes.map((r) => r.id)).toEqual(['south-col', 'north-col']);
    for (const id of ['k2', 'manaslu', 'ama-dablam', 'lhotse']) expect(asset.peaks[id].routes).toEqual([]);
    expect(asset.peaks.everest.routes.find((r) => r.id === 'north-col').style).toBe('dashed');
    expect(asset.peaks.everest.routes.find((r) => r.id === 'south-col').style).toBe('solid');
  });

  it('routes are interpretive, never observed; interpolated at 1″ and inside the Everest patch', () => {
    for (const route of asset.peaks.everest.routes) {
      expect(route.provenance).toBe('interpretive');
      expect(route.stepArcsec).toBe(1);
      for (let k = 1; k < route.waypoints.length; k++) {
        const [aLat, aLon] = route.waypoints[k - 1]; const [bLat, bLon] = route.waypoints[k];
        expect(Math.max(Math.abs(bLat - aLat), Math.abs(bLon - aLon) * Math.cos((aLat * Math.PI) / 180)) * 3600).toBeLessThanOrEqual(1.01); // published at 1e-6°
      }
      for (const [lat, lon] of route.waypoints) expect(inPatch('everest', lat, lon)).toBe(true);
    }
    expect(assetBytes.toString('utf8')).not.toContain('"observed"');
  });

  it('every camp is in its peak patch or marked outsidePatch / without position', () => {
    for (const [peakId, peak] of Object.entries(asset.peaks)) {
      for (const c of peak.camps) {
        if (c.lat == null) { expect(c.listOnly).toBe('no-position'); expect(c.marker).toBe(false); continue; }
        expect(inPatch(peakId, c.lat, c.lon)).toBe(!c.outsidePatch);
        if (c.outsidePatch) { expect(c.listOnly).toBe('outside-patch'); expect(c.marker).toBe(false); }
      }
    }
    expect(camp('everest', 'everest-n-bc')).toMatchObject({ outsidePatch: true, marker: false, listOnly: 'outside-patch', demElevationM: null });
    expect(camp('everest', 'everest-n-int')).toMatchObject({ outsidePatch: true, marker: false, listOnly: 'outside-patch' });
  });

  it('camp order and reported elevations increase along each route', () => {
    for (const peak of Object.values(asset.peaks)) {
      const byRoute = Map.groupBy(peak.camps, (c) => c.route);
      for (const list of byRoute.values()) {
        for (let k = 1; k < list.length; k++) {
          expect(list[k].order).toBeGreaterThan(list[k - 1].order);
          expect(list[k].reportedElevationM).toBeGreaterThan(list[k - 1].reportedElevationM);
        }
      }
    }
  });

  it('demElevationM is GLO-30 at the point (recomputed here) and demDeltaM = reported − GLO-30', () => {
    for (const [peakId, id] of [['everest', 'everest-s-c4'], ['k2', 'k2-c2'], ['manaslu', 'manaslu-c1']]) {
      const c = camp(peakId, id);
      expect(Math.abs(c.demElevationM - demAt(peakId, c.lat, c.lon))).toBeLessThan(0.051);
      expect(c.demDeltaM).toBe(Math.round(c.reportedElevationM - c.demElevationM));
    }
  });

  it('flag exactly above 50 m, no marker above 150 m', () => {
    expect(campDisplay({ hasPosition: true, outsidePatch: false, demDeltaM: FLAG_DELTA_M })).toEqual({ marker: true, listOnly: null, flag: false });
    expect(campDisplay({ hasPosition: true, outsidePatch: false, demDeltaM: -(FLAG_DELTA_M + 1) })).toEqual({ marker: true, listOnly: null, flag: true });
    expect(campDisplay({ hasPosition: true, outsidePatch: false, demDeltaM: MARKER_MAX_DELTA_M })).toEqual({ marker: true, listOnly: null, flag: true });
    expect(campDisplay({ hasPosition: true, outsidePatch: false, demDeltaM: MARKER_MAX_DELTA_M + 1 })).toEqual({ marker: false, listOnly: 'inconsistent', flag: true });
    for (const peak of Object.values(asset.peaks)) {
      for (const c of peak.camps.filter((x) => x.demDeltaM != null)) {
        expect(c.flag).toBe(Math.abs(c.demDeltaM) > 50);
        expect(c.marker).toBe(Math.abs(c.demDeltaM) <= 150);
      }
    }
    // The verified cases (final values in the report).
    expect(camp('k2', 'k2-c2')).toMatchObject({ marker: false, listOnly: 'inconsistent' });
    expect(camp('k2', 'k2-c3')).toMatchObject({ marker: false, listOnly: 'inconsistent' });
    expect(camp('manaslu', 'manaslu-north-col')).toMatchObject({ marker: false, listOnly: 'inconsistent' });
    expect(camp('ama-dablam', 'ama-dablam-c2')).toMatchObject({ marker: false, listOnly: 'inconsistent' });
    expect(camp('manaslu', 'manaslu-c1')).toMatchObject({ marker: true, flag: false, reportedElevationM: 5500, reportedRangeM: [5500, 5700] });
    expect(camp('ama-dablam', 'ama-dablam-c3')).toMatchObject({ marker: true, flag: false, reportedElevationM: 6277 });
  });

  it('⚠ strictly above 50 m, for positive and negative Δ (Manaslu C4: 7500 − 7424.6 → +75 m ⚠)', () => {
    const at = (demDeltaM, demDerived = false) => campDisplay({ hasPosition: true, outsidePatch: false, demDeltaM, demDerived }).flag;
    expect([45, 50, 51, -45, -50, -51].map((d) => at(d))).toEqual([false, false, true, false, false, true]);
    expect(camp('manaslu', 'manaslu-c4')).toMatchObject({ reportedElevationM: 7500, elevationSource: 'explorersweb-manaslu', demDeltaM: 75, flag: true, marker: true });
    expect(camp('ama-dablam', 'ama-dablam-c3')).toMatchObject({ demDeltaM: -29, flag: false });
  });

  it('likely DEM-derived OSM elevations: never the main value when a published one exists, never flagged', () => {
    const at = (demDeltaM) => campDisplay({ hasPosition: true, outsidePatch: false, demDeltaM, demDerived: true });
    expect(at(120)).toEqual({ marker: true, listOnly: null, flag: false });
    expect(at(-200)).toEqual({ marker: false, listOnly: 'inconsistent', flag: false });
    for (const peak of Object.values(asset.peaks)) {
      for (const c of peak.camps) {
        if (c.elevationDemDerived) expect(c.flag, c.id).toBe(false);
        expect(c.sources.filter((x) => x.demDerived).every((x) => x.role === 'reference' || c.elevationDemDerived), c.id).toBe(true);
      }
    }
    // Everest South Col route: OSM ele on nodes whose position is tagged SRTM (no source for ele) -> Arnette is the main value.
    for (const [id, node, reported] of [['everest-s-c1', 4880806686, 5944], ['everest-s-c2', 4880806685, 6400], ['everest-s-c3', 5058632244, 7163]]) {
      const c = camp('everest', id);
      expect(c).toMatchObject({ elevationSource: 'arnette-everest', elevationDemDerived: false, reportedElevationM: reported, positionSource: `osm:node/${node}` });
      expect(c.sources.find((x) => x.ref === `osm:node/${node}` && x.demDerived)).toMatchObject({ role: 'reference', evidence: expect.stringContaining('SRTM') });
    }
    expect(camp('everest', 'everest-s-c3').reportedRangeM).toEqual([7010, 7163]); // 7100 (OSM, DEM-derived) is not in the range
    const derived = campRow({ ...camp('everest', 'everest-s-c2'), elevationDemDerived: true, flag: false }, asset.references)[1];
    expect(derived.startsWith('OSM elevation (likely DEM-derived) 6,400 m · GLO-30 at this point: 6,392 m')).toBe(true);
    expect(derived).not.toContain('⚠');
  });

  it('two-point camps: one marker at the Wikidata position, the other point kept in sources', () => {
    const bc = camp('everest', 'everest-s-bc');
    expect(bc).toMatchObject({ positionSource: 'wikidata:Q99671286', lat: 28.007222, lon: 86.859444, reportedElevationM: 5364, marker: true });
    expect(bc.sources.some((s) => s.ref === 'osm:node/5225912921' && s.role === 'reference')).toBe(true);
    const col = camp('everest', 'everest-s-c4');
    expect(col).toMatchObject({ positionSource: 'wikidata:Q2598195', reportedElevationM: 7906, elevationSource: 'wikidata:Q2598195' });
    expect(col.sources.some((s) => s.ref === 'osm:node/576713400' && s.value === 7920 && s.demDerived)).toBe(true);
  });

  it('Lhotse C4 has no coordinates (listed only); Lhotse C1–C3 reuse the Everest camps', () => {
    expect(camp('lhotse', 'lhotse-c4')).toMatchObject({ lat: null, lon: null, positionSource: null, positionProvenance: null, marker: false, listOnly: 'no-position', reportedElevationM: 7850, demElevationM: null });
    for (const k of ['c1', 'c2', 'c3']) {
      expect(camp('lhotse', `lhotse-${k}`)).toMatchObject({ lat: camp('everest', `everest-s-${k}`).lat, lon: camp('everest', `everest-s-${k}`).lon, sharedWith: `everest/everest-s-${k}` });
    }
  });

  it('camp positions are reported (OSM / Wikidata) or absent; feet are converted', () => {
    for (const peak of Object.values(asset.peaks)) {
      for (const c of peak.camps) {
        if (c.positionSource) { expect(c.positionSource).toMatch(/^(osm:node\/\d+|wikidata:Q\d+)$/); expect(c.positionProvenance).toBe('reported'); }
      }
    }
    expect(feetToMetres(19500)).toBe(5944);
    expect(camp('everest', 'everest-s-c1')).toMatchObject({ reportedElevationM: 5944, elevationOriginal: { value: 19500, unit: 'ft' }, elevationSource: 'arnette-everest', reportedRangeM: null });
  });

  it('contains no Himalayan Database data', () => {
    const published = assetBytes.toString('utf8').toLowerCase();
    expect(published).not.toContain('himalayandatabase');
    expect(published).not.toContain('himalayan database');
    // The source only states the exclusion in its comment; no reference, URL or value from the database.
    const source = JSON.parse(read('tools/data/himalaya-routes-source.json').toString('utf8'));
    const { $comment, ...facts } = source;
    expect($comment).toContain('No data from The Himalayan Database');
    expect(JSON.stringify(facts).toLowerCase()).not.toMatch(/himalayan ?database|hdb/);
  });
});

describe('LOT 14 UI texts and opt-in behaviour', () => {
  it('nothing is loaded, drawn or noted while both switches are off', () => {
    const off = { showRoutes: false, showCamps: false, status: 'idle' };
    expect(wantsRouteData(off)).toBe(false);
    expect(wantsRouteData({ ...off, showCamps: true })).toBe(true);
    expect(wantsRouteData({ ...off, showRoutes: true, status: 'ready' })).toBe(false);
    expect(wantsRouteData({ ...off, showRoutes: true, status: 'error' })).toBe(false); // no automatic retry after the guard gave up
    expect(routeSectionRows({ ...off, peakId: 'everest', data: asset })).toEqual([]);
    expect(switchNote({ ...off, peakId: 'everest', data: asset })).toBe('');
    expect(routesBarSegment(off)).toBeNull();
    expect(composeProvenanceBar({ routes: routesBarSegment(off) })).not.toMatch(/Routes|Camps/);
    // The page fetches the routes file only via wantsRouteData; the scene imports the line modules only to draw a route.
    const app = read('src/himalaya/himalaya-app.js').toString('utf8');
    expect(app.match(/loadRoutes\(\)/g)).toHaveLength(2); // the definition and the single guarded call
    expect(app).toContain('if (wantsRouteData(routes)) loadRoutes();');
    const scene = read('src/himalaya/himalaya-scene.js').toString('utf8');
    expect(scene).not.toMatch(/^import .*three\/addons\/lines/m);
    expect(scene).toContain("import('three/addons/lines/Line2.js')");
  });

  it('switches: role="switch", aria-checked, both OFF in the page', () => {
    const html = read('living-himalaya.html').toString('utf8');
    for (const id of ['himalayaRoutesSwitch', 'himalayaCampsSwitch']) {
      expect(html).toMatch(new RegExp(`id="${id}"[^>]*role="switch"[^>]*aria-checked="false"`));
    }
    expect(html).toContain('>Routes</span>');
    expect(html).toContain('>Camps (Base Camp + C1…C4)</span>');
  });

  it('panel rows: disclaimer first, reported vs GLO-30 with Δ, ⚠ above 50 m, notes', () => {
    const rows = routeSectionRows({ peakId: 'everest', data: asset, status: 'ready', showRoutes: true, showCamps: true, terrainMode: 'glo30' });
    expect(rows[0]).toEqual(['Note', TEXT.disclaimer]);
    expect(TEXT.disclaimer).toBe('Approximate routes, for visualization only — not for navigation.');
    expect(rows.find(([k]) => k === 'Route provenance')[1]).toBe(TEXT.routeNote);
    const values = Object.fromEntries(rows.map(([k, v]) => [k, v]));
    expect(values['C4 · Camp 4 (South Col)']).toBe('reported 7,906 m (Wikidata; sources 7,906–8,000 m) · GLO-30 at this point: 7,865 m · Δ +42 m · Position reported by Wikidata');
    expect(values['ABC · Advanced Base Camp (glacier)']).toMatch(/Δ \+77 m ⚠/);
    expect(values['BC · Everest Base Camp (North, Tibet)']).toBe('reported 5,150 m (Wikidata) · outside the detailed terrain');
    expect(rows.some(([, v]) => v === TEXT.glacier)).toBe(true);
    expect(rows.at(-1)[1]).toContain('© OpenStreetMap contributors (ODbL)');
    const k2 = Object.fromEntries(routeSectionRows({ peakId: 'k2', data: asset, status: 'ready', showRoutes: true, showCamps: true }).map(([k, v]) => [k, v]));
    expect(k2.Routes).toBe('No route line for this peak (camps only)');
    expect(k2['C2 · Camp 2 (above House\'s Chimney)']).toContain(TEXT.inconsistent);
    expect(k2['C4 · Camp 4 (Shoulder) (glacier)']).toContain('no published position — listed only');
    expect(campLabel(camp('everest', 'everest-s-c2'))).toBe('C2 · 6,400 m');
    expect(values['C1 · Camp 1 (top of the Khumbu Icefall) (glacier)']).toBe('reported 5,944 m (19,500 ft; Alan Arnette, Everest FAQ) · GLO-30 at this point: 6,042 m · Δ −98 m ⚠ · Position reported by OpenStreetMap');
    expect(campRow(camp('lhotse', 'lhotse-c4'), asset.references)[1]).toBe('reported 7,850 m (Alan Arnette, Lhotse FAQ) · no published position — listed only');
  });

  it('peaks without data, loading, failure and the Terrarium note', () => {
    for (const id of peakIds.filter((p) => !HIMALAYA_ROUTE_PEAK_IDS.includes(p))) {
      expect(routeSectionRows({ peakId: id, data: asset, status: 'ready', showCamps: true }).at(-1)).toEqual(['Routes & camps', 'No route data for this peak', 'pending']);
    }
    expect(peakIds.filter((p) => !HIMALAYA_ROUTE_PEAK_IDS.includes(p))).toHaveLength(15);
    expect(routeSectionRows({ peakId: 'everest', data: null, status: 'loading', showRoutes: true }).at(-1)[1]).toBe('loading…');
    expect(routeSectionRows({ peakId: 'everest', data: null, status: 'error', showRoutes: true }).at(-1)[1]).toBe('Route data temporarily unavailable');
    expect(switchNote({ showRoutes: true, status: 'ready', peakId: 'cho-oyu', data: asset })).toContain('No route data for this peak');
    expect(switchNote({ showRoutes: true, status: 'ready', peakId: 'everest', data: asset, terrainMode: 'terrarium' })).toContain('hidden in the Terrarium overview');
  });

  it('sources: registry entries (interpretive routes, reported camps) and the OSM attribution link', () => {
    expect(SOURCE_DEFINITIONS.himalayaRoutes.provenance).toBe('interpretive');
    expect(SOURCE_DEFINITIONS.himalayaCamps.provenance).toBe('reported');
    expect(SOURCE_DEFINITIONS.himalayaRoutes.license).toContain('ODbL');
    expect(ROUTES_ATTRIBUTION.link.href).toBe('https://www.openstreetmap.org/copyright');
    expect(ROUTES_ATTRIBUTION.text).toBe('© OpenStreetMap contributors (ODbL) · Wikidata (CC0)');
  });
});
