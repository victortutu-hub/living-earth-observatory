// Living Himalaya LOT 14: builds assets/himalaya/routes-<hash>.json and the
// generated config src/config/himalaya-routes.js from the hand-written source
// tools/data/himalaya-routes-source.json.
//
// NO network: GLO-30 elevations come from the shipped patches
// (assets/himalaya/glo30-*.ktx2, decoded locally). The tool validates the
// source, converts feet to metres, interpolates every route at 1 arc-second,
// samples GLO-30 at each camp and route vertex (bilinear), computes
// demDeltaM = reported - GLO-30 and the marker/flag decision, then validates
// the result with the same rules as the tests (src/himalaya/routes-model.js).
//
// Usage: node tools/build-himalaya-routes.mjs [--report]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const SOURCE = path.join(ROOT, 'tools/data/himalaya-routes-source.json');
const ASSET_DIR = path.join(ROOT, 'assets/himalaya');
const CONFIG_OUT = path.join(ROOT, 'src/config/himalaya-routes.js');
const REPORT = process.argv.includes('--report');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { HIMALAYA_ALL_PEAKS, getHimalayaPeak } = await load('src/config/himalaya-peaks.js');
const { getTerrainPatch } = await load('src/config/himalaya-terrain-patches.js');
const { decodePatch } = await load('src/himalaya/patch-grid.js');
const {
  ROUTES_SCHEMA, TEXT, campDisplay, toMetres, validateRoutesAsset,
} = await load('src/himalaya/routes-model.js');

const zstd = { decode: (d) => new Uint8Array(zlib.zstdDecompressSync(Buffer.from(d.buffer, d.byteOffset, d.byteLength))) };
const sourceBytes = fs.readFileSync(SOURCE);
const source = JSON.parse(sourceBytes.toString('utf8'));
const peakIds = HIMALAYA_ALL_PEAKS.map((p) => p.id);
const die = (message) => { console.error(`build-himalaya-routes: ${message}`); process.exit(1); };

// --- GLO-30 sampling on the shipped patches
const heightCache = new Map();
function patchFor(peakId) {
  const meta = getTerrainPatch(peakId);
  if (!meta) die(`${peakId}: no GLO-30 patch`);
  if (!heightCache.has(meta.file)) heightCache.set(meta.file, decodePatch(new Uint8Array(fs.readFileSync(path.join(ROOT, meta.file))), meta, zstd).heights);
  return { meta, heights: heightCache.get(meta.file) };
}
function gridPos(meta, lat, lon) {
  return { fj: meta.latTopArcsec - lat * 3600, fi: lon * 3600 - meta.lonLeftArcsec };
}
function inPatch(peakId, lat, lon) {
  const meta = getTerrainPatch(peakId);
  const { fj, fi } = gridPos(meta, lat, lon);
  return fj >= 0 && fi >= 0 && fj <= meta.rows - 1 && fi <= meta.cols - 1;
}
function sampleDem(peakId, lat, lon) {
  if (!inPatch(peakId, lat, lon)) return null;
  const { meta, heights } = patchFor(peakId);
  const { fj, fi } = gridPos(meta, lat, lon);
  const j = Math.min(meta.rows - 2, Math.floor(fj)); const i = Math.min(meta.cols - 2, Math.floor(fi));
  const v = fj - j; const u = fi - i;
  const g = (jj, ii) => heights[jj * meta.cols + ii];
  return (1 - v) * ((1 - u) * g(j, i) + u * g(j, i + 1)) + v * ((1 - u) * g(j + 1, i) + u * g(j + 1, i + 1));
}
const round = (value, digits) => Number(value.toFixed(digits));

// --- references
const references = source.references || {};
function checkRef(ref, where) {
  if (typeof ref !== 'string') die(`${where}: missing ref`);
  if (/^osm:node\/\d+$/.test(ref) || /^wikidata:Q\d+$/.test(ref)) return;
  if (!references[ref]?.url) die(`${where}: unknown reference ${ref}`);
}

// --- camps
function resolveCamp(peakId, camp) {
  if (!camp.sameAs) return camp;
  const [otherPeak, otherId] = camp.sameAs.split('/');
  const base = source.peaks[otherPeak]?.camps?.find((c) => c.id === otherId);
  if (!base) die(`${peakId}/${camp.id}: sameAs ${camp.sameAs} not found`);
  return { ...base, ...camp, sharedWith: camp.sameAs };
}

function buildCamp(peakId, raw, order) {
  const camp = resolveCamp(peakId, raw);
  const where = `${peakId}/${camp.id}`;
  for (const key of ['id', 'route', 'short', 'name', 'elevation']) if (camp[key] == null) die(`${where}: missing ${key}`);
  checkRef(camp.elevation.ref, `${where} elevation`);
  const reported = toMetres(camp.elevation);
  const alternates = camp.alternates || [];
  alternates.forEach((a, k) => checkRef(a.ref, `${where} alternate ${k}`));
  // Likely DEM-derived OSM values are not reported elevations: kept in sources, excluded from the range.
  const values = [reported, ...alternates.filter((a) => Number.isFinite(a.value) && !a.demDerived).map(toMetres)];
  const range = Math.min(...values) !== Math.max(...values) ? [Math.min(...values), Math.max(...values)] : null;
  const position = camp.position || null;
  if (position) {
    checkRef(position.ref, `${where} position`);
    if (!/^(osm:node\/|wikidata:)/.test(position.ref)) die(`${where}: a position needs OSM or Wikidata coordinates`);
  }
  const hasPosition = Boolean(position);
  const outsidePatch = hasPosition && !inPatch(peakId, position.lat, position.lon);
  const sampled = hasPosition && !outsidePatch ? sampleDem(peakId, position.lat, position.lon) : null;
  const dem = sampled == null ? null : round(sampled, 1); // the published value; Δ is computed from it
  const demDeltaM = dem == null ? null : Math.round(reported - dem);
  const demDerived = Boolean(camp.elevation.demDerived);
  const display = campDisplay({ hasPosition, outsidePatch, demDeltaM: demDeltaM ?? 0, demDerived });
  return {
    id: camp.id, route: camp.route, short: camp.short, name: camp.name, kind: camp.kind || 'camp', order,
    lat: hasPosition ? position.lat : null, lon: hasPosition ? position.lon : null,
    positionSource: hasPosition ? position.ref : null,
    positionProvenance: hasPosition ? 'reported' : null,
    reportedElevationM: reported, reportedRangeM: range,
    elevationSource: camp.elevation.ref,
    elevationDemDerived: demDerived,
    elevationOriginal: camp.elevation.unit === 'm' ? null : { value: camp.elevation.value, unit: camp.elevation.unit },
    demElevationM: dem == null ? null : round(dem, 1), demDeltaM,
    flag: display.flag, marker: display.marker, listOnly: display.listOnly, outsidePatch,
    glacier: Boolean(camp.glacier), note: camp.note || (display.listOnly === 'inconsistent' ? TEXT.inconsistent : null),
    sharedWith: camp.sharedWith || null,
    sources: [
      ...(hasPosition ? [{ ref: position.ref, role: 'position', lat: position.lat, lon: position.lon }] : []),
      { ref: camp.elevation.ref, role: 'elevation', value: camp.elevation.value, unit: camp.elevation.unit, ...(demDerived ? { demDerived: true, evidence: camp.elevation.evidence || null } : {}) },
      ...alternates.map((a) => ({ ref: a.ref, role: 'reference', ...(Number.isFinite(a.lat) ? { lat: a.lat, lon: a.lon } : {}), ...(Number.isFinite(a.value) ? { value: a.value, unit: a.unit } : {}), ...(a.demDerived ? { demDerived: true, evidence: a.evidence || null } : {}) })),
    ],
  };
}

// --- routes: straight segments between the via points, interpolated at 1"
function densify(points) {
  const out = [];
  for (let k = 0; k < points.length - 1; k++) {
    const [aLat, aLon] = points[k]; const [bLat, bLon] = points[k + 1];
    const cos = Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bLat - aLat) * 3600, Math.abs(bLon - aLon) * 3600 * cos)));
    for (let s = 0; s < steps; s++) out.push([aLat + ((bLat - aLat) * s) / steps, aLon + ((bLon - aLon) * s) / steps]);
  }
  out.push(points[points.length - 1]);
  return out;
}
function lengthKm(points) {
  let sum = 0;
  for (let k = 1; k < points.length; k++) {
    const [aLat, aLon] = points[k - 1]; const [bLat, bLon] = points[k];
    const cos = Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
    sum += Math.hypot((bLat - aLat) * 111.195, (bLon - aLon) * 111.195 * cos);
  }
  return sum;
}
function buildRoute(peakId, route, camps) {
  const where = `${peakId}/${route.id}`;
  const peak = getHimalayaPeak(peakId);
  const via = route.via.map((v, k) => {
    if (v.camp) {
      const camp = camps.find((c) => c.id === v.camp);
      if (!camp || camp.lat == null || camp.outsidePatch) die(`${where}: via ${k} camp ${v.camp} has no usable position`);
      return { label: camp.short, ref: camp.positionSource, lat: camp.lat, lon: camp.lon };
    }
    if (v.summit) return { label: 'Summit', ref: 'summit', lat: peak.lat, lon: peak.lon };
    checkRef(v.ref, `${where} via ${k}`);
    return { label: v.feature, ref: v.ref, lat: v.lat, lon: v.lon };
  });
  const dense = densify(via.map((v) => [v.lat, v.lon]));
  const waypoints = dense.map(([lat, lon]) => {
    const dem = sampleDem(peakId, lat, lon);
    if (dem == null) die(`${where}: waypoint ${lat},${lon} outside the GLO-30 patch`);
    return [round(lat, 6), round(lon, 6), round(dem, 1)];
  });
  return {
    id: route.id, name: route.name, side: route.side, style: route.style === 'dashed' ? 'dashed' : 'solid',
    provenance: 'interpretive', note: route.note || null,
    via: via.map(({ label, ref }) => ({ label, ref })),
    stepArcsec: 1, lengthKm: round(lengthKm(dense), 2), waypoints,
    sources: [...new Set(via.map((v) => v.ref).filter((r) => r !== 'summit'))],
  };
}

const peaks = {};
for (const [peakId, entry] of Object.entries(source.peaks)) {
  if (!peakIds.includes(peakId)) die(`${peakId}: unknown peak`);
  const camps = (entry.camps || []).map((camp, k) => buildCamp(peakId, camp, k + 1));
  const routes = (entry.routes || []).map((route) => buildRoute(peakId, route, camps));
  peaks[peakId] = { routes, camps };
}

const asset = {
  schema: ROUTES_SCHEMA,
  checked: source.checked,
  sourceSha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
  license: { osm: 'ODbL-1.0', wikidata: 'CC0-1.0', note: 'This file is published under the Open Database License (ODbL 1.0), separately from the repository licence; it contains positions from OpenStreetMap (© OpenStreetMap contributors) and Wikidata (CC0). Elevations cite their sources; facts only.' },
  attribution: [`${TEXT.osmAttribution} — ${TEXT.osmCopyrightUrl}`, TEXT.wikidataAttribution],
  provenance: { routes: 'interpretive', campPositions: 'reported (OpenStreetMap / Wikidata coordinates); camps without coordinates are listed only' },
  glo30: 'Copernicus DEM GLO-30, sampled bilinearly on the shipped 1" patches (assets/himalaya/glo30-*.ktx2)',
  references,
  peaks,
};

const errors = validateRoutesAsset(asset, { peakIds, inPatch });
if (errors.length) die(`invalid asset:\n  ${errors.join('\n  ')}`);

const json = `${JSON.stringify(asset)}\n`;
const sha = crypto.createHash('sha256').update(json).digest('hex');
const fileName = `routes-${sha.slice(0, 10)}.json`;
for (const old of fs.readdirSync(ASSET_DIR)) if (/^routes-[0-9a-f]{10}\.json$/.test(old) && old !== fileName) fs.unlinkSync(path.join(ASSET_DIR, old));
fs.writeFileSync(path.join(ASSET_DIR, fileName), json);

const config = `// GENERATED by tools/build-himalaya-routes.mjs from tools/data/himalaya-routes-source.json (checked ${source.checked}) - do not edit by hand.
// Living Himalaya LOT 14: classic routes (interpretive) and camps (reported
// positions) for the approved peaks; the file itself is published under ODbL.
// Loaded only when the user turns on "Routes" or "Camps".
export const HIMALAYA_ROUTES_ASSET = Object.freeze(${JSON.stringify({ file: `assets/himalaya/${fileName}`, sha256: sha, bytes: Buffer.byteLength(json), checked: source.checked, sourceSha256: asset.sourceSha256 })});
export const HIMALAYA_ROUTE_PEAK_IDS = Object.freeze(${JSON.stringify(Object.keys(peaks))});
`;
fs.writeFileSync(CONFIG_OUT, config);

console.log(JSON.stringify({ file: `assets/himalaya/${fileName}`, sha256: sha, bytes: Buffer.byteLength(json) }));
if (REPORT) {
  for (const [peakId, peak] of Object.entries(peaks)) {
    for (const r of peak.routes) console.log(`${peakId} route ${r.id}: ${r.waypoints.length} vertices, ${r.lengthKm} km, ${r.style}`);
    for (const c of peak.camps) {
      console.log([peakId, c.short, c.name, `reported ${c.reportedElevationM}${c.reportedRangeM ? ` (${c.reportedRangeM.join('–')})` : ''}`, `dem ${c.demElevationM ?? '—'}`, `Δ ${c.demDeltaM ?? '—'}`,
        c.marker ? (c.flag ? 'marker ⚠' : 'marker') : `list only (${c.listOnly})`].join(' | '));
    }
  }
}
