// Living Himalaya LOT 26: builds assets/himalaya/glaciers-<hash>.bin, the generated config
// src/config/himalaya-glaciers.js and the RGI block of NOTICE.md from the RGI 7.0 region files
// (regions 14 South Asia West and 15 South Asia East) kept locally in tmp/himalaya/rgi7/
// (ignored by git, never in an archive).
//
// NO network, no dependency: ZIP (tools/lib/zip-read.mjs), SHP (tools/lib/shp.mjs) and DBF
// (tools/lib/vfp-dbf.mjs) readers of the repository; zstd from node:zlib.
//   1. SHA-256 of both inputs checked first; the .prj must be geographic WGS 84.
//   2. Every outline whose box touches a GLO-30 patch rectangle (19 patches; Yalung Kang uses
//      the Kangchenjunga patch) is kept once (rgi_id); per patch: the glaciers that touch it.
//   3. Douglas-Peucker at TOLERANCE_M on a local metric frame, then clipped to the patch
//      rectangle as polylines (no line along the edge); a glacier crossing the edge is "clipped".
//   4. Mask R8 per patch, sampled at the GLO-30 grid points from the original rings.
//   5. Region 13 (Central Asia) is not loaded on purpose: the report lists, per patch, the share
//      of high, gentle terrain (GLO-30 > 5500 m, slope < 25 deg) not covered by an outline, a
//      hint for glaciers that may belong to another region.
//
// Usage: node tools/build-himalaya-glaciers.mjs [--report] [--check]   (--check: write nothing)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readZipEntries } from './lib/zip-read.mjs';
import { readShpPolygons } from './lib/shp.mjs';
import { readDbfRecords } from './lib/vfp-dbf.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const INPUT_DIR = path.join(ROOT, 'tmp/himalaya/rgi7');
const ASSET_DIR = path.join(ROOT, 'assets/himalaya');
const CONFIG_OUT = path.join(ROOT, 'src/config/himalaya-glaciers.js');
const NOTICE = path.join(ROOT, 'NOTICE.md');
const REPORT = process.argv.includes('--report');
const CHECK = process.argv.includes('--check');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

export const RGI_INPUTS = Object.freeze([
  Object.freeze({ region: '14', name: 'South Asia West', file: 'RGI2000-v7.0-G-14_south_asia_west.zip', bytes: 49_958_252, sha256: '7cd63bbe0dd8b93cb0581c6fd25c3b6a04de21539514110493af9d9bd5a58c57' }),
  Object.freeze({ region: '15', name: 'South Asia East', file: 'RGI2000-v7.0-G-15_south_asia_east.zip', bytes: 25_758_739, sha256: '089cbe0743669448aa3b7d1f91915853b9d014cb1ba6e3b01c0a926946bf9ebe' }),
]);

const {
  GLACIERS_SCHEMA, GLACIERS_MAGIC, GLACIERS_VERSION, TOLERANCE_M, QUANT, MAX_ASSET_BYTES, ARCSEC_M,
  GLACIER_CITATION, GLACIER_SUBSET, GLACIER_LICENSE_NOTE, outlineDay, encodeLines, simplifyRing, clipRingToRect, rasterizeRings,
} = await load('src/himalaya/glaciers-model.js');
const { HIMALAYA_TERRAIN_PATCHES, HIMALAYA_SELECTED_TERRAIN_PATCHES, HIMALAYA_SHARED_PATCH_POINTS } = await load('src/config/himalaya-terrain-patches.js');
const { decodePatch } = await load('src/himalaya/patch-grid.js');

const die = (message) => { console.error(`build-himalaya-glaciers: ${message}`); process.exit(1); };
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const zstd = { decode: (d) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(d.buffer, d.byteOffset, d.byteLength))) };
const compress = (raw) => zlib.zstdCompressSync(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength), { params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 } });

// --- 1. inputs
const regions = [];
for (const input of RGI_INPUTS) {
  const file = path.join(INPUT_DIR, input.file);
  if (!fs.existsSync(file)) die(`missing input ${path.relative(ROOT, file)}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== input.bytes || sha256(bytes) !== input.sha256) die(`${input.file}: size or SHA-256 differs from the approved input`);
  const zip = readZipEntries(bytes);
  const base = input.file.replace(/\.zip$/, '');
  const prj = zip.get(`${base}.prj`)?.toString('utf8') || '';
  if (!/^GEOGCS\["GCS_WGS_1984",DATUM\["D_WGS_1984"/.test(prj) || !/UNIT\["Degree"/.test(prj)) die(`${input.file}: unexpected coordinate system ${prj}`);
  const submissions = parseCsv(zip.get(`${base}-submission_info.csv`).toString('utf8'));
  regions.push({ ...input, zip, base, prj, submissions, readme: zip.get('README.md').toString('utf8') });
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const cells = []; let cell = ''; let quoted = false;
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (quoted) { if (c === '"' && line[k + 1] === '"') { cell += '"'; k++; } else if (c === '"') quoted = false; else cell += c; }
      else if (c === '"') quoted = true; else if (c === ',') { cells.push(cell); cell = ''; } else cell += c;
    }
    cells.push(cell);
    rows.push(cells);
  }
  const [head, ...body] = rows;
  return body.map((cells) => Object.fromEntries(head.map((h, k) => [h, cells[k]])));
}

// --- 2. patches (19 GLO-30 rectangles; shared points use their owner's patch)
const patchMeta = { ...HIMALAYA_TERRAIN_PATCHES, ...HIMALAYA_SELECTED_TERRAIN_PATCHES };
const patchIds = Object.keys(patchMeta).filter((id) => patchMeta[id].rows).sort();
const sharedPoints = Object.keys(HIMALAYA_SHARED_PATCH_POINTS || {});
const boxes = patchIds.map((id) => {
  const m = patchMeta[id];
  return { id, meta: m, n: m.latTopArcsec / 3600, s: (m.latTopArcsec - m.rows + 1) / 3600, w: m.lonLeftArcsec / 3600, e: (m.lonLeftArcsec + m.cols - 1) / 3600 };
});
const touches = (bb, b) => bb[0] <= b.e && bb[2] >= b.w && bb[1] <= b.n && bb[3] >= b.s;

const glaciers = new Map(); // rgi_id -> { attrs, rings (lon/lat), patches: Set }
for (const region of regions) {
  const attrs = new Map();
  for (const a of readDbfRecords(region.zip.get(`${region.base}.dbf`), ['RGI_ID', 'O1REGION', 'GLAC_NAME', 'SRC_DATE', 'AREA_KM2', 'TERM_TYPE', 'SURGE_TYPE', 'SUBM_ID', 'CENLON', 'CENLAT'], { withIndex: true })) attrs.set(a.$index, a);
  for (const rec of readShpPolygons(region.zip.get(`${region.base}.shp`), { filter: (bb) => boxes.some((b) => touches(bb, b)) })) {
    const a = attrs.get(rec.index);
    if (!a?.RGI_ID) die(`${region.file}: record ${rec.index} without attributes`);
    const hit = boxes.filter((b) => touches(rec.bbox, b)).map((b) => b.id);
    const known = glaciers.get(a.RGI_ID);
    if (known) { hit.forEach((id) => known.patches.add(id)); continue; } // dedupe by rgi_id
    glaciers.set(a.RGI_ID, { attrs: a, region: region.region, rings: rec.rings, patches: new Set(hit) });
  }
}
const regionsSeen = new Set([...glaciers.values()].map((g) => g.attrs.O1REGION));
if ([...regionsSeen].some((r) => r !== '14' && r !== '15')) die(`unexpected first-order regions ${[...regionsSeen].join(',')}`);

// Glacier table: sorted by rgi_id (deterministic).
const table = [...glaciers.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, g]) => ({
  id, name: g.attrs.GLAC_NAME || null, date: outlineDay(g.attrs.SRC_DATE), areaKm2: Math.round(g.attrs.AREA_KM2 * 1000) / 1000,
  termType: g.attrs.TERM_TYPE ?? null, surgeType: g.attrs.SURGE_TYPE ?? null, subm: g.attrs.SUBM_ID ?? null, region: g.region,
  cen: [g.attrs.CENLON, g.attrs.CENLAT], rings: g.rings, patches: g.patches,
}));

// --- 3-4. per patch: simplified + clipped polylines, mask, stats
const sections = [];
let sectionOffset = 0;
const pushSection = (raw) => {
  const packed = compress(raw);
  const entry = { offset: sectionOffset, bytes: packed.length, rawBytes: raw.length };
  sections.push(packed); sectionOffset += packed.length;
  return entry;
};
const patchesOut = {};
const report = [];
let worstDeviation = 0;
for (const box of boxes) {
  const { meta } = box;
  const lat0 = ((box.n + box.s) / 2) * Math.PI / 180;
  const mx = ARCSEC_M * Math.cos(lat0); const my = ARCSEC_M; // metres per grid step (x: lon, y: lat)
  const toGrid = (lon, lat) => [lon * 3600 - meta.lonLeftArcsec, meta.latTopArcsec - lat * 3600];
  const members = table.filter((g) => g.patches.has(box.id));
  const gridRings = [];
  const polylines = [];
  const entries = [];
  members.forEach((g) => {
    let clipped = false;
    const own = [];
    const ownRings = [];
    for (const ring of g.rings) {
      const grid = new Float64Array(ring.length);
      for (let k = 0; k < ring.length; k += 2) { const [x, y] = toGrid(ring[k], ring[k + 1]); grid[k] = x; grid[k + 1] = y; }
      // Drop the repeated closing vertex of shapefile rings.
      const open = grid[0] === grid.at(-2) && grid[1] === grid.at(-1) ? grid.slice(0, -2) : grid;
      ownRings.push(open);
      const metric = open.map((v, k) => (k % 2 ? v * my : v * mx));
      const simplified = simplifyRing(metric, TOLERANCE_M);
      const back = simplified.map((v, k) => (k % 2 ? v / my : v / mx));
      const result = clipRingToRect(back, meta.cols - 1, meta.rows - 1);
      if (result.clipped) clipped = true;
      own.push(...result.polylines);
      if (REPORT && open.length <= 4000) worstDeviation = Math.max(worstDeviation, deviation(metric, simplified));
    }
    // Only the box touched the patch: the outline itself is outside -> not a glacier of this patch.
    if (!own.length) return;
    const local = entries.length;
    gridRings.push(...ownRings);
    for (const points of own) polylines.push({ glacier: local, points });
    const [cx, cy] = toGrid(g.cen[0], g.cen[1]);
    const inside = cx >= 0 && cy >= 0 && cx <= meta.cols - 1 && cy <= meta.rows - 1;
    entries.push({ id: g.id, clipped, label: inside ? [round2(cx), round2(cy)] : null });
  });
  // Label point for glaciers whose centre is outside: the middle vertex of their longest polyline.
  entries.forEach((entry, local) => {
    if (entry.label) return;
    const own = polylines.filter((p) => p.glacier === local).sort((a, b) => b.points.length - a.points.length)[0];
    if (own) { const mid = Math.floor(own.points.length / 4) * 2; entry.label = [round2(own.points[mid]), round2(own.points[mid + 1])]; }
  });
  const mask = rasterizeRings(gridRings, meta.rows, meta.cols);
  const lines = encodeLines(polylines);
  let inside = 0; for (let k = 0; k < mask.length; k++) inside += mask[k];
  const pixelKm2 = (mx * my) / 1e6;
  const kept = new Set(entries.map((e) => e.id));
  const dates = members.filter((g) => kept.has(g.id)).map((g) => g.date).filter(Boolean).sort();
  const clippedCount = entries.filter((e) => e.clipped).length;
  patchesOut[box.id] = {
    rows: meta.rows, cols: meta.cols,
    glaciers: entries,
    clippedCount,
    insideAreaKm2: Math.round(inside * pixelKm2 * 10) / 10,
    dateMin: dates[0] || null, dateMax: dates.at(-1) || null,
    vertices: polylines.reduce((s, p) => s + p.points.length / 2, 0),
    mask: pushSection(mask),
    lines: pushSection(lines),
  };
  const gap = regionGap(box, mask);
  report.push({ id: box.id, glaciers: entries.length, insideAreaKm2: patchesOut[box.id].insideAreaKm2, dateMin: dates[0], dateMax: dates.at(-1), clipped: clippedCount, vertices: patchesOut[box.id].vertices, named: members.filter((g) => kept.has(g.id) && g.name).length, gapPercent: gap });
}

// Final glacier table: only outlines that reach at least one patch (sorted by rgi_id), entries re-indexed.
const usedIds = new Set(Object.values(patchesOut).flatMap((p) => p.glaciers.map((e) => e.id)));
const finalTable = table.filter((g) => usedIds.has(g.id));
const finalIndex = new Map(finalTable.map((g, k) => [g.id, k]));
for (const p of Object.values(patchesOut)) p.glaciers = p.glaciers.map(({ id, ...rest }) => ({ g: finalIndex.get(id), ...rest }));
console.log(`glaciers whose box touched a patch but whose outline does not: ${table.length - finalTable.length}`);
table.length = 0;
table.push(...finalTable);

function round2(v) { return Math.round(v * 100) / 100; }
function deviation(original, simplified) {
  // Exhaustive check (offline report only): every original vertex against the simplified ring.
  let worst = 0; const m = simplified.length / 2;
  for (let k = 0; k < original.length; k += 2) {
    let best = Infinity;
    for (let s = 0; s < m; s++) {
      const t = (s + 1) % m; const ax = simplified[s * 2]; const ay = simplified[s * 2 + 1]; const bx = simplified[t * 2]; const by = simplified[t * 2 + 1];
      const dx = bx - ax; const dy = by - ay; const len2 = dx * dx + dy * dy;
      const u = len2 ? Math.max(0, Math.min(1, ((original[k] - ax) * dx + (original[k + 1] - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(original[k] - (ax + u * dx), original[k + 1] - (ay + u * dy)));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

// Share of high, gentle GLO-30 terrain not covered by an outline (hint for region 13, not loaded).
function regionGap(box, mask) {
  const { meta } = box;
  const bytes = fs.readFileSync(path.join(ROOT, meta.file));
  const { heights } = decodePatch(new Uint8Array(bytes), meta, zstd);
  const { rows, cols } = meta;
  let high = 0; let uncovered = 0;
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      const h = heights[j * cols + i];
      if (h < 5500) continue;
      const gx = (heights[j * cols + i + 1] - heights[j * cols + i - 1]) / (2 * 30.87 * Math.cos(box.n * Math.PI / 180));
      const gy = (heights[(j + 1) * cols + i] - heights[(j - 1) * cols + i]) / (2 * 30.87);
      if (Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI >= 25) continue;
      high++;
      if (!mask[j * cols + i]) uncovered++;
    }
  }
  return high ? Math.round((uncovered / high) * 1000) / 10 : null;
}

// --- asset
const usedSubm = new Set(table.map((g) => g.subm));
const submissions = regions.flatMap((r) => r.submissions.map((s) => ({ ...s, region: r.region })))
  .filter((s) => usedSubm.has(Number(s.subm_id)))
  .map((s) => ({ region: s.region, submId: Number(s.subm_id), analysts: s.analysts, submitters: s.submitters, affiliation: s.chief_affl, analysisTime: s.anlys_time.slice(0, 10), process: s.proc_desc,
    outlinesInSubset: table.filter((g) => g.subm === Number(s.subm_id) && g.region === s.region).length }))
  .filter((s) => s.outlinesInSubset > 0);
const header = {
  schema: GLACIERS_SCHEMA,
  source: { citation: GLACIER_CITATION, subset: GLACIER_SUBSET, license: GLACIER_LICENSE_NOTE, inputs: RGI_INPUTS.map(({ file, bytes, sha256: h }) => ({ file, bytes, sha256: h })), crs: 'WGS 84 geographic (.prj)', toleranceM: TOLERANCE_M, quant: QUANT, submissions },
  glaciers: table.map(({ id, name, date, areaKm2, termType, surgeType, subm, region }) => ({ id, name, date, areaKm2, termType, surgeType, subm, region })),
  patches: patchesOut,
};
const json = Buffer.from(JSON.stringify(header), 'utf8');
const prefix = Buffer.alloc(12);
prefix.write(GLACIERS_MAGIC, 0, 'ascii'); prefix.writeUInt32LE(GLACIERS_VERSION, 4); prefix.writeUInt32LE(json.length, 8);
const asset = Buffer.concat([prefix, json, ...sections]);
if (asset.length > MAX_ASSET_BYTES) die(`asset is ${asset.length} B, above the ${MAX_ASSET_BYTES} B cap`);
const hash = sha256(asset);
const file = `assets/himalaya/glaciers-${hash.slice(0, 10)}.bin`;

// --- config (small: the asset, the inputs and the per-peak summary; the glacier table stays in the asset)
const peaks = Object.fromEntries([...patchIds.map((id) => [id, id]), ...sharedPoints.map((id) => [id, HIMALAYA_SHARED_PATCH_POINTS[id].patchOf])].sort(([a], [b]) => (a < b ? -1 : 1)).map(([peakId, patchId]) => {
  const p = patchesOut[patchId];
  return [peakId, { patch: patchId, glaciers: p.glaciers.length, clipped: p.clippedCount, insideAreaKm2: p.insideAreaKm2, dateMin: p.dateMin, dateMax: p.dateMax }];
}));
const config = `// GENERATED by tools/build-himalaya-glaciers.mjs - do not edit by hand.
// RGI 7.0 glacier outlines (regions 14-15) on the 19 GLO-30 summit patches: outlines simplified at
// ${TOLERANCE_M} m and clipped to each patch, plus an R8 mask sampled at the GLO-30 grid points.
// The glacier table (rgi_id, glac_name, src_date, area_km2, term_type, surge_type, clipped per
// patch) lives in the asset: it is fetched only once the Glaciers switch is on.

export const HIMALAYA_GLACIERS_ASSET = Object.freeze(${JSON.stringify({ file, bytes: asset.length, sha256: hash, schema: GLACIERS_SCHEMA, glaciers: table.length, toleranceM: TOLERANCE_M })});
export const HIMALAYA_GLACIER_INPUTS = Object.freeze(${JSON.stringify(RGI_INPUTS.map(({ region, name, file: f, bytes, sha256: h }) => ({ region, name, file: f, bytes, sha256: h })))});
export const HIMALAYA_GLACIER_SUBMISSIONS = Object.freeze(${JSON.stringify(submissions.map(({ region, submId, analysts, affiliation, outlinesInSubset }) => ({ region, submId, analysts, affiliation, outlinesInSubset })))});
export const HIMALAYA_GLACIER_PEAKS = Object.freeze(${JSON.stringify(peaks)});
`;

// --- NOTICE block (generated)
const noticeBlock = `<!-- glaciers:begin (generated by tools/build-himalaya-glaciers.mjs) -->
### Glacier outlines (Living Himalaya)

${GLACIER_CITATION} Online access: https://doi.org/10.5067/f6jmovy5navz

${GLACIER_SUBSET}. ${GLACIER_LICENSE_NOTE}.

GLIMS submissions used in this subset (from the RGI 7.0 submission_info.csv files):
${submissions.map((s) => `- Region ${s.region}, submission ${s.submId}: ${s.analysts} (analysts), ${s.affiliation}; ${s.outlinesInSubset} outlines in the subset; analysis ${s.analysisTime}.`).join('\n')}
<!-- glaciers:end -->`;

if (REPORT || CHECK) {
  console.log(`inputs ok (SHA-256): ${RGI_INPUTS.map((i) => i.file).join(', ')}; CRS: ${regions[0].prj}`);
  console.log(`glaciers (deduplicated by rgi_id): ${table.length}; first-order regions: ${[...regionsSeen].sort().join(', ')}; region 13 not loaded`);
  console.log(`asset ${file}: ${asset.length} B (cap ${MAX_ASSET_BYTES}); header JSON ${json.length} B; worst DP deviation (rings <= 4000 vertices, metres): ${worstDeviation.toFixed(2)}`);
  console.log('peak/patch       glaciers  area-in-patch  outlines dated           clipped  named  vertices  high-gentle-uncovered');
  for (const r of report) console.log(`${r.id.padEnd(16)} ${String(r.glaciers).padStart(8)}  ${r.insideAreaKm2.toFixed(1).padStart(9)} km2  ${r.dateMin}..${r.dateMax}  ${String(r.clipped).padStart(7)}  ${String(r.named).padStart(5)}  ${String(r.vertices).padStart(8)}  ${r.gapPercent ?? '-'} %`);
  console.log(`submissions: ${submissions.map((s) => `${s.region}/${s.submId} ${s.analysts} (${s.affiliation}) ${s.outlinesInSubset}`).join('; ')}`);
}
if (CHECK) process.exit(0);

for (const old of fs.readdirSync(ASSET_DIR).filter((f) => /^glaciers-[0-9a-f]{10}\.bin$/.test(f) && `assets/himalaya/${f}` !== file)) fs.unlinkSync(path.join(ASSET_DIR, old));
fs.writeFileSync(path.join(ROOT, file), asset);
fs.writeFileSync(CONFIG_OUT, config);
const notice = fs.readFileSync(NOTICE, 'utf8');
const marker = /<!-- glaciers:begin[\s\S]*?<!-- glaciers:end -->/;
fs.writeFileSync(NOTICE, marker.test(notice) ? notice.replace(marker, noticeBlock) : `${notice.trimEnd()}\n\n${noticeBlock}\n`);
console.log(`wrote ${file} (${asset.length} B), ${path.relative(ROOT, CONFIG_OUT)}, NOTICE.md (RGI block)`);
