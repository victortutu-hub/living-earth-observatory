// LOT 26 — Living Himalaya: glacier outlines (RGI 7.0, regions 14-15) — asset, geometry, texts,
// opt-in loading, provenance and registry. The RGI inputs live only in tmp/ (not in git): the
// determinism check runs only where they are present.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  GLACIER_CITATION, GLACIER_LICENSE_NOTE, GLACIER_SUBSET, GLACIER_TEXT, MAX_ASSET_BYTES, QUANT, TOLERANCE_M,
  clipRingToRect, decodeGlaciersAsset, decodeLines, douglasPeucker, encodeLines, glacierLabel, glacierPanelNote, glacierSectionRows,
  glacierSwitchNote, glaciersBarSegment, maxRingDeviation, outlineDates, outlineDay, rasterizeRings, simplifyRing, wantsGlacierData,
} from '../src/himalaya/glaciers-model.js';
import { HIMALAYA_GLACIERS_ASSET, HIMALAYA_GLACIER_INPUTS, HIMALAYA_GLACIER_PEAKS, HIMALAYA_GLACIER_SUBMISSIONS } from '../src/config/himalaya-glaciers.js';
import { HIMALAYA_TERRAIN_PATCHES, HIMALAYA_SELECTED_TERRAIN_PATCHES } from '../src/config/himalaya-terrain-patches.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { HIMALAYA_ALL_PEAK_IDS } from '../src/config/himalaya-peaks.js';
import { composeProvenanceBar } from '../src/himalaya/himalaya-provenance.js';

const text = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const exists = (p) => fs.existsSync(new URL(`../${p}`, import.meta.url));
const zstd = { decode: (d) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(d.buffer, d.byteOffset, d.byteLength))) };
const assetBytes = fs.readFileSync(new URL(`../${HIMALAYA_GLACIERS_ASSET.file}`, import.meta.url));
const asset = decodeGlaciersAsset(new Uint8Array(assetBytes), zstd);
const patchMeta = { ...HIMALAYA_TERRAIN_PATCHES, ...HIMALAYA_SELECTED_TERRAIN_PATCHES };

describe('LOT 26: inputs and asset', () => {
  it('approved inputs (bytes + SHA-256), checked by the tool before anything else', () => {
    expect(HIMALAYA_GLACIER_INPUTS).toEqual([
      { region: '14', name: 'South Asia West', file: 'RGI2000-v7.0-G-14_south_asia_west.zip', bytes: 49_958_252, sha256: '7cd63bbe0dd8b93cb0581c6fd25c3b6a04de21539514110493af9d9bd5a58c57' },
      { region: '15', name: 'South Asia East', file: 'RGI2000-v7.0-G-15_south_asia_east.zip', bytes: 25_758_739, sha256: '089cbe0743669448aa3b7d1f91915853b9d014cb1ba6e3b01c0a926946bf9ebe' },
    ]);
    const tool = text('tools/build-himalaya-glaciers.mjs');
    expect(tool).toContain("die(`${input.file}: size or SHA-256 differs from the approved input`)");
    expect(tool).toContain('die(`${input.file}: unexpected coordinate system ${prj}`)');
    expect(tool).not.toMatch(/\bfetch\(|https?:\/\/(?!doi\.org)/); // no network (the DOI is only text)
  });

  it('the asset matches its config (size, SHA-256, name) and stays under 2 MB', () => {
    expect(assetBytes.length).toBe(HIMALAYA_GLACIERS_ASSET.bytes);
    const hash = crypto.createHash('sha256').update(assetBytes).digest('hex');
    expect(hash).toBe(HIMALAYA_GLACIERS_ASSET.sha256);
    expect(HIMALAYA_GLACIERS_ASSET.file).toBe(`assets/himalaya/glaciers-${hash.slice(0, 10)}.bin`);
    expect(assetBytes.length).toBeLessThanOrEqual(MAX_ASSET_BYTES);
    expect(MAX_ASSET_BYTES).toBe(2 * 1024 * 1024);
    expect(fs.readdirSync(new URL('../assets/himalaya/', import.meta.url)).filter((f) => f.startsWith('glaciers-'))).toEqual([HIMALAYA_GLACIERS_ASSET.file.split('/').pop()]);
  });

  it('19 patches (Yalung Kang uses Kangchenjunga), glaciers deduplicated by rgi_id, regions 14-15 only', () => {
    const ids = Object.keys(patchMeta).filter((id) => patchMeta[id].rows).sort();
    expect(Object.keys(asset.header.patches).sort()).toEqual(ids);
    expect(ids).toHaveLength(19);
    expect(HIMALAYA_GLACIER_PEAKS['yalung-kang'].patch).toBe('kangchenjunga');
    expect(Object.keys(HIMALAYA_GLACIER_PEAKS).sort()).toEqual([...HIMALAYA_ALL_PEAK_IDS].sort());
    const rgiIds = asset.header.glaciers.map((g) => g.id);
    expect(new Set(rgiIds).size).toBe(rgiIds.length);
    expect(rgiIds.length).toBe(HIMALAYA_GLACIERS_ASSET.glaciers);
    expect(new Set(asset.header.glaciers.map((g) => g.region))).toEqual(new Set(['14', '15']));
    for (const info of Object.values(asset.header.patches)) expect(new Set(info.glaciers.map((e) => e.g)).size).toBe(info.glaciers.length);
  });

  it('per patch: mask = rows x cols at the grid points, lines inside the patch, clipped flags, dates', () => {
    for (const [id, info] of Object.entries(asset.header.patches)) {
      const meta = patchMeta[id];
      expect([info.rows, info.cols]).toEqual([meta.rows, meta.cols]);
      const mask = asset.mask(id);
      expect(mask.length).toBe(meta.rows * meta.cols);
      expect(mask.every((v) => v === 0 || v === 1)).toBe(true);
      const lines = asset.lines(id);
      let maxGlacier = -1; let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      for (const { glacier, points } of lines) {
        maxGlacier = Math.max(maxGlacier, glacier);
        for (let k = 0; k < points.length; k += 2) {
          minX = Math.min(minX, points[k]); maxX = Math.max(maxX, points[k]);
          minY = Math.min(minY, points[k + 1]); maxY = Math.max(maxY, points[k + 1]);
        }
      }
      expect(lines.length, id).toBeGreaterThan(0);
      expect(maxGlacier, id).toBeLessThan(info.glaciers.length);
      expect([minX >= 0, maxX <= meta.cols - 1 + 1 / QUANT, minY >= 0, maxY <= meta.rows - 1 + 1 / QUANT], id).toEqual([true, true, true, true]);
      // Every glacier of the patch has at least one outline piece (inside rings included).
      expect(new Set(lines.map((l) => l.glacier)).size, id).toBe(info.glaciers.length);
      expect(info.clippedCount).toBe(info.glaciers.filter((e) => e.clipped).length);
      expect(info.dateMin <= info.dateMax).toBe(true);
    }
  });

  it('Khumbu-side (Everest), Godwin-Austen side (K2) and Concordia / upper Baltoro (Broad Peak) are covered', () => {
    const names = (id) => asset.header.patches[id].glaciers.map((e) => asset.header.glaciers[e.g].name).filter(Boolean);
    expect(asset.header.patches.everest.glaciers.length).toBeGreaterThan(50);
    expect(names('everest').some((n) => /Lhotse|Nuptse|Rongbuk/.test(n))).toBe(true);
    expect(names('k2')).toContain('Baltoro Glacier');
    expect(asset.header.patches.k2.glaciers.find((e) => asset.header.glaciers[e.g].name === 'Baltoro Glacier').clipped).toBe(true);
    expect(names('broad-peak')).toContain('Baltoro Glacier');
  });

  it('a second run gives the same asset (only where the RGI inputs are present locally)', () => {
    const inputs = HIMALAYA_GLACIER_INPUTS.map((i) => `tmp/himalaya/rgi7/${i.file}`);
    if (!inputs.every(exists)) return; // CI: the raw RGI files are not in git
    const out = execFileSync(process.execPath, ['tools/build-himalaya-glaciers.mjs', '--check', '--report'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    expect(out).toContain(`asset ${HIMALAYA_GLACIERS_ASSET.file}: ${HIMALAYA_GLACIERS_ASSET.bytes} B`);
    const worst = Number(/worst DP deviation[^:]*: ([\d.]+)/.exec(out)[1]);
    expect(worst).toBeLessThanOrEqual(TOLERANCE_M);
  }, 120_000);

  it('no raw RGI data in git or in the deploy paths', () => {
    expect(text('.gitignore')).toMatch(/^tmp\/$/m);
    for (const dir of ['assets/himalaya', 'src/config', 'src/himalaya']) {
      expect(fs.readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => /\.(shp|shx|dbf|prj|zip)$|rgi2000/i.test(f))).toEqual([]);
    }
  });
});

describe('LOT 26: geometry', () => {
  const wiggly = () => {
    const ring = [];
    for (let k = 0; k < 400; k++) { const a = (k / 400) * Math.PI * 2; const r = 1000 + 30 * Math.sin(a * 17) + 8 * Math.sin(a * 91); ring.push(r * Math.cos(a), r * Math.sin(a)); }
    return Float64Array.from(ring);
  };

  it('Douglas-Peucker 15 m: max deviation <= tolerance, far fewer vertices', () => {
    const ring = wiggly();
    const simplified = simplifyRing(ring, TOLERANCE_M);
    expect(TOLERANCE_M).toBe(15);
    expect(simplified.length).toBeLessThan(ring.length / 2);
    expect(maxRingDeviation(ring, simplified)).toBeLessThanOrEqual(TOLERANCE_M + 1e-9);
    expect(Array.from(douglasPeucker(Float64Array.from([0, 0, 5, 1, 10, 0]), 2))).toEqual([0, 0, 10, 0]);
  });

  it('clipping to the patch: inside ring stays closed; a crossing ring becomes polylines without edge lines', () => {
    const square = Float64Array.from([2, 2, 8, 2, 8, 8, 2, 8]);
    const inside = clipRingToRect(square, 10, 10);
    expect(inside.clipped).toBe(false);
    expect(Array.from(inside.polylines[0])).toEqual([2, 2, 8, 2, 8, 8, 2, 8, 2, 2]);
    const crossing = clipRingToRect(Float64Array.from([5, 5, 15, 5, 15, 8, 5, 8]), 10, 10);
    expect(crossing.clipped).toBe(true);
    const all = crossing.polylines.flatMap((p) => Array.from(p));
    for (let k = 0; k < all.length; k += 2) expect(all[k]).toBeLessThanOrEqual(10);
    // No segment runs along x = 10 (the edge): the two pieces end on it but are not joined there.
    for (const p of crossing.polylines) for (let k = 0; k + 3 < p.length; k += 2) expect(p[k] === 10 && p[k + 2] === 10).toBe(false);
    expect(clipRingToRect(Float64Array.from([20, 20, 30, 20, 30, 30]), 10, 10)).toEqual({ polylines: [], clipped: true });
  });

  it('mask: even-odd fill at grid points, holes stay empty, shared edges stay filled', () => {
    const mask = rasterizeRings([Float64Array.from([0.5, 0.5, 6.5, 0.5, 6.5, 6.5, 0.5, 6.5]), Float64Array.from([2.5, 2.5, 4.5, 2.5, 4.5, 4.5, 2.5, 4.5])], 8, 8);
    expect(mask[1 * 8 + 1]).toBe(1);
    expect(mask[3 * 8 + 3]).toBe(0); // hole (nunatak)
    expect(mask[7 * 8 + 7]).toBe(0);
    const pair = rasterizeRings([Float64Array.from([0.5, 0.5, 3.5, 0.5, 3.5, 3.5, 0.5, 3.5]), Float64Array.from([3.5, 0.5, 6.5, 0.5, 6.5, 3.5, 3.5, 3.5])], 5, 8);
    expect([...pair.subarray(2 * 8, 2 * 8 + 8)]).toEqual([0, 1, 1, 1, 1, 1, 1, 0]);
  });

  it('16-bit lines round-trip at 1/64 of a grid step', () => {
    const raw = encodeLines([{ glacier: 3, points: [0, 0, 1.5, 2.25, 733.98, 651.02] }]);
    const [line] = decodeLines(raw);
    expect(line.glacier).toBe(3);
    Array.from(line.points).forEach((v, k) => expect(Math.abs(v - [0, 0, 1.5, 2.25, 733.98, 651.02][k])).toBeLessThanOrEqual(0.5 / QUANT));
    expect(() => encodeLines([{ glacier: 0, points: [2000, 0] }])).toThrow(/out of range/);
  });
});

describe('LOT 26: texts and labels', () => {
  it('label "<name or RGI id> · outline <date>" and the clipped note', () => {
    expect(outlineDay('1998-06-11T00:00:00')).toBe('1998-06-11');
    expect(glacierLabel({ id: 'RGI2000-v7.0-G-15-01234', name: 'Lothse Glacier', date: '1998-06-11' })).toBe('Lothse Glacier · outline 1998-06-11');
    expect(glacierLabel({ id: 'RGI2000-v7.0-G-15-01234', name: null, date: '2001-12-20' }, { clipped: true }))
      .toBe('RGI2000-v7.0-G-15-01234 · outline 2001-12-20 · outline clipped at the detailed terrain edge');
  });

  it('panel note with the Sentinel-2 date (approved text), and without an image', () => {
    expect(glacierPanelNote({ outlineDate: outlineDates('1998-06-11', '2001-12-20'), imageDate: '2026-11-10' }))
      .toBe('Outline: RGI 7.0, mapped on 1998-06-11 to 2001-12-20. The Sentinel-2 image shows the ice of 2026-11-10: where they differ, the glacier has changed since the outline was drawn — or snow and debris hid its edge.');
    expect(glacierPanelNote({ outlineDate: '2002-07-10', imageDate: null })).toMatch(/^Outline: RGI 7.0, mapped on 2002-07-10\. Switch to Satellite/);
  });

  it('off by default: no note, no bar segment, no rows; data wanted only once (status idle)', () => {
    expect(glacierSwitchNote({ show: false })).toBe('');
    expect(glaciersBarSegment({ show: false })).toBeNull();
    expect(glacierSectionRows({ show: false })).toEqual([]);
    expect(wantsGlacierData({ show: false, status: 'idle' })).toBe(false);
    expect(wantsGlacierData({ show: true, status: 'idle' })).toBe(true);
    expect(['loading', 'ready', 'error'].map((status) => wantsGlacierData({ show: true, status }))).toEqual([false, false, false]);
    expect(glacierSwitchNote({ show: true, status: 'ready', peakId: 'everest', data: asset.header, terrainMode: 'terrarium' })).toBe(GLACIER_TEXT.terrarium);
    expect(composeProvenanceBar({ glaciers: glaciersBarSegment({ show: true }) })).toContain('Glaciers: RGI 7.0 outlines (observed, dated ~1992–2010)');
  });

  it('panel rows for Everest from the real asset', () => {
    const rows = glacierSectionRows({ peakId: 'everest', patchId: 'everest', header: asset.header, status: 'ready', show: true, terrainMode: 'glo30' });
    expect(rows.map(([label]) => label)).toEqual(['Outlines', 'Ice within the terrain', 'Outline dates', 'Largest']);
    expect(rows[0][1]).toMatch(/^\d+ RGI 7\.0 glaciers touch the detailed terrain \(\d+ clipped at its edge\)$/);
  });
});

describe('LOT 26: page wiring (opt-in, zero cost while off)', () => {
  it('switch OFF by default next to Routes/Camps; CSS bumped for the glacier labels', () => {
    const html = text('living-himalaya.html');
    expect(html).toContain('<button id="himalayaGlaciersSwitch" class="himalaya-switch" type="button" role="switch" aria-checked="false">');
    expect(html).toContain('./styles/himalaya.css?v=himalayaLot26');
    expect(text('styles/himalaya.css')).toContain('.himalaya-camp-label.is-glacier { color: #9feaff; }');
  });

  it('the asset is fetched only through wantsGlacierData (first activation), never at start', () => {
    const app = text('src/himalaya/himalaya-app.js');
    expect(app).toContain('if (wantsGlacierData(glaciers)) loadGlaciers();');
    expect(app.match(/(?<!function )loadGlaciers\(\)/g)).toHaveLength(1); // one call site
    expect(app).toContain("const glaciers = { show: false, status: 'idle', bytes: null, header: null, requests: 0 };");
    expect(app).toContain("key: 'himalaya-glaciers', url: new URL(HIMALAYA_GLACIERS_ASSET.file, document.baseURI).href, responseType: 'arrayBuffer',");
  });

  it('scene: base materials untouched while off; tint variant only on the overlay patch; hidden in Terrarium', () => {
    const scene = text('src/himalaya/himalaya-scene.js');
    expect(scene).toContain('entry.mesh.material = [glacierTintOn(entry) ? glacierVariantOf(base) : base, wallMaterial];');
    expect(scene).toContain("return Boolean(glacierOverlay?.show && entry && entry.id === glacierOverlay.patchId && entry.glacierMaskKey);");
    expect(scene).toContain("if (!glacierOverlay?.show || glacierOverlay.patchId !== activePatchId || terrainMode !== 'glo30' || fade) return false;");
    expect(scene).toContain("import('three/addons/lines/LineSegments2.js')");
  });
});

describe('LOT 26: provenance, NOTICE and registry', () => {
  it('source: observed, with the approved note, the citation and the licence statement', () => {
    const source = SOURCE_DEFINITIONS.himalayaGlaciers;
    expect(source.provenance).toBe('observed');
    expect(source.provenanceNote).toBe('Glacier outlines — RGI 7.0 (RGI 7.0 Consortium 2023, NSIDC), mapped from imagery around 2000; each outline keeps its own date. Observed, not current');
    expect(source.license).toContain(GLACIER_LICENSE_NOTE);
    expect(source.license).toContain('doi:10.5067/f6jmovy5navz');
    expect(GLACIER_CITATION).toBe('RGI 7.0 Consortium, 2023. Randolph Glacier Inventory - A Dataset of Global Glacier Outlines, Version 7.0. Boulder, Colorado USA. NSIDC: National Snow and Ice Data Center. doi:10.5067/f6jmovy5navz.');
    expect(GLACIER_SUBSET).toBe('subset: regions 14–15, clipped to the summit patches, simplified at 15 m');
  });

  it('NOTICE: generated block with the citation, the licence note and the analysts of the submissions used', () => {
    const notice = text('NOTICE.md');
    const block = /<!-- glaciers:begin[\s\S]*?<!-- glaciers:end -->/.exec(notice)[0];
    expect(block).toContain(GLACIER_CITATION);
    expect(block).toContain(GLACIER_LICENSE_NOTE);
    expect(HIMALAYA_GLACIER_SUBMISSIONS.length).toBeGreaterThan(0);
    for (const s of HIMALAYA_GLACIER_SUBMISSIONS) expect(block).toContain(`Region ${s.region}, submission ${s.submId}: ${s.analysts} (analysts), ${s.affiliation}; ${s.outlinesInSubset} outlines`);
    expect(HIMALAYA_GLACIER_SUBMISSIONS.reduce((n, s) => n + s.outlinesInSubset, 0)).toBe(HIMALAYA_GLACIERS_ASSET.glaciers);
  });

  it('Himalaya: new criterion done with evidence, 12/12 = 100 %, source declared', () => {
    const himalaya = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya');
    const criterion = himalaya.roadmap.criteria.find((c) => c.id === 'glacier-outlines');
    expect(criterion).toMatchObject({ label: 'Glacier outlines (RGI 7.0, dated)', done: true });
    expect(criterion.evidence).toContain('test himalaya-lot26');
    expect(himalaya.roadmap.criteria).toHaveLength(12);
    expect(himalaya.roadmap.progress).toBe(100);
    expect(himalaya.roadmap.next).toBe('All criteria met — next: glacier change (Hugonnet 2021, licence to confirm)');
    expect(himalaya.sources).toContain('himalayaGlaciers');
  });
});
