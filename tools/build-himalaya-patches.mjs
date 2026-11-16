// Living Himalaya LOT 2: offline build of the 14 Copernicus GLO-30 terrain
// patches (20 x 20 km around each summit). Run locally, never on the server:
//
//   node tools/build-himalaya-patches.mjs [--log tmp/himalaya/lot2-etapa1-requests.json]
//       [--budget N] [--accessed YYYY-MM-DD] [--accessed-eight-thousanders YYYY-MM-DD]
//       [--report tmp/himalaya/lot2-build-report.json]
//
// LOT 7: also the selected Nepal peaks (HIMALAYA_SELECTED_PEAKS). A peak with
// `patchOf` gets no patch of its own: its DEM summit value and summit fill
// share are computed on its own point inside the patch it shares. The access
// date is per group: the 14 keep the date of their existing build (so their
// rebuilt assets are byte-identical, from the raw-response cache), the
// selected peaks use --accessed (default: today).
//
// Network (all enumerated in the request log; the build aborts above --budget):
//   * per needed DEM tile: one header read (Range 0-65535) + merged Range reads
//     of the 1024 x 1024 COG blocks that the patches touch;
//   * per needed tile: the whole Filling Mask (AUXFILES/*_FLM.tif, ~1.5 MB).
// Raw responses are kept in tmp/himalaya/glo30-cache/ so a rebuild does not
// repeat requests.
//
// Grid: GLO-30 is RasterPixelIsPoint (Product Handbook I6.1 §1.2.3), 1" in
// both axes below 50°N; the corner pixel centres of a tile sit on integer
// degrees: pixel (row r, col c) of tile N<la>_E<lo> is at
// lat = la + 1 - r/3600, lon = lo + c/3600. Patches are cut on that global
// 1" grid, mosaicking up to 4 tiles (Everest/Lhotse).
//
// Output:
//   assets/himalaya/glo30-<peak>-<sha256:10>.ktx2  VK_FORMAT_R16_UNORM + Zstd,
//       q = round((h - offset) / 0.25 m), offset/scale/fill % in the KVD;
//   src/config/himalaya-terrain-patches.js       frozen metadata for the app;
//   tmp/himalaya/lot2-build-report.json          build report.
// FLM pixel values (Product Handbook I6.1, Table 7): 0 void, 1 edited (not
// filled), 2 not edited / not filled, 3 ASTER, 4 SRTM90, 5 SRTM30,
// 6 GMTED2010, 7 SRTM30plus, 8 TerraSAR-X radargrammetric DEM, 9 AW3D30,
// 100 Norway DEM, 101 DSM05 Spain, 102 Norway DEM v2. Values >= 3 = filled
// from another source.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeKtx2R16, decodeKtx2R16F, VK_FORMAT_R16_UNORM } from './lib/ktx2-r16f.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const LOG_PATH = path.resolve(ROOT, arg('--log', 'tmp/himalaya/lot2-etapa1-requests.json'));
const BUDGET = Number(arg('--budget', 200));
const CACHE_DIR = path.join(ROOT, 'tmp/himalaya/glo30-cache');
const ASSET_DIR = path.join(ROOT, 'assets/himalaya');
const CONFIG_OUT = path.join(ROOT, 'src/config/himalaya-terrain-patches.js');
const REPORT_OUT = path.resolve(ROOT, arg('--report', 'tmp/himalaya/lot2-build-report.json'));
const BUCKET = 'https://copernicus-dem-30m.s3.amazonaws.com';
const HALF_KM = 10;
const SCALE_M = 0.25;
const SUMMIT_RADIUS_M = 150;
const FILL_SUMMIT_RADIUS_M = 1000;
const ACCESSED = arg('--accessed', new Date().toISOString().slice(0, 10));
const FLM_SOURCES = Object.freeze({ 3: 'ASTER', 4: 'SRTM90', 5: 'SRTM30', 6: 'GMTED2010', 7: 'SRTM30plus', 8: 'TerraSAR-X radargrammetric DEM', 9: 'AW3D30', 100: 'Norway DEM', 101: 'DSM05 Spain', 102: 'Norway DEM v2' });

const { HIMALAYA_PEAKS, HIMALAYA_SELECTED_PEAKS } = await import(pathToFileURL(path.join(ROOT, 'src/config/himalaya-peaks.js')).href);
const previousConfig = fs.existsSync(CONFIG_OUT) ? await import(pathToFileURL(CONFIG_OUT).href) : {};
const ACCESSED_14 = arg('--accessed-eight-thousanders', previousConfig.GLO30_ACCESSED || ACCESSED);
const accessedFor = (peak) => (peak.group === 'selected-nepal' ? ACCESSED : ACCESSED_14);
const OWN_PATCH_PEAKS = [...HIMALAYA_PEAKS, ...HIMALAYA_SELECTED_PEAKS.filter((p) => !p.patchOf)];
const SHARED_PATCH_PEAKS = HIMALAYA_SELECTED_PEAKS.filter((p) => p.patchOf);
for (const p of SHARED_PATCH_PEAKS) if (!OWN_PATCH_PEAKS.some((o) => o.id === p.patchOf)) throw new Error(`${p.id}: patchOf ${p.patchOf} has no patch`);

// ---------------------------------------------------------------- requests
fs.mkdirSync(CACHE_DIR, { recursive: true });
const log = fs.existsSync(LOG_PATH) ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')) : { budget: BUDGET, requests: [] };
let networkRequests = 0;
async function getBytes(label, url, range = null) {
  const cacheName = crypto.createHash('sha1').update(`${url}|${range || ''}`).digest('hex');
  const cacheFile = path.join(CACHE_DIR, cacheName);
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile);
  if (log.requests.length >= BUDGET) throw new Error(`Request budget ${BUDGET} reached; stop and ask for approval.`);
  const entry = { n: log.requests.length + 1, label, url, range };
  const t0 = Date.now();
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: range ? { Range: `bytes=${range}` } : {}, signal: AbortSignal.timeout(120000) });
      const buf = Buffer.from(await res.arrayBuffer());
      Object.assign(entry, { status: res.status, bytes: buf.length, ms: Date.now() - t0 });
      log.requests.push(entry);
      networkRequests += 1;
      fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 1));
      if (!(res.status === 200 || res.status === 206)) throw new Error(`HTTP ${res.status} for ${url}`);
      fs.writeFileSync(cacheFile, buf);
      return buf;
    } catch (error) {
      lastError = error;
      if (entry.status) throw error;
    }
  }
  Object.assign(entry, { error: String(lastError), ms: Date.now() - t0 });
  log.requests.push(entry);
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 1));
  throw lastError;
}

// ---------------------------------------------------------------- TIFF
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };
function readIfd0(buf) {
  if (buf.toString('latin1', 0, 2) !== 'II' || buf.readUInt16LE(2) !== 42) throw new Error('Only little-endian classic TIFF is supported.');
  const ifd = buf.readUInt32LE(4);
  const count = buf.readUInt16LE(ifd);
  const tags = {};
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    const tag = buf.readUInt16LE(at);
    const type = buf.readUInt16LE(at + 2);
    const n = buf.readUInt32LE(at + 4);
    const size = (TYPE_SIZE[type] || 1) * n;
    const dataAt = size <= 4 ? at + 8 : buf.readUInt32LE(at + 8);
    if (dataAt + size > buf.length) throw new Error(`Tag ${tag} lies outside the header read (${dataAt + size} > ${buf.length}).`);
    const values = [];
    for (let k = 0; k < n; k++) {
      const p = dataAt + k * (TYPE_SIZE[type] || 1);
      values.push(type === 3 ? buf.readUInt16LE(p) : type === 4 ? buf.readUInt32LE(p) : type === 12 ? buf.readDoubleLE(p) : type === 16 ? Number(buf.readBigUInt64LE(p)) : buf[p]);
    }
    tags[tag] = values;
  }
  const one = (t, d) => (tags[t] ? tags[t][0] : d);
  const geoKeys = {};
  if (tags[34735]) {
    const k = tags[34735];
    for (let i = 4; i + 3 < k.length; i += 4) geoKeys[k[i]] = k[i + 3];
  }
  return {
    width: one(256), height: one(257), bits: one(258), compression: one(259, 1), predictor: one(317, 1),
    sampleFormat: one(339, 1),
    // Tiled (COG) or, as a fallback, stripped layout (a strip = a full-width tile).
    tileWidth: one(322, one(256)), tileHeight: one(323, one(278, one(257))),
    offsets: tags[324] || tags[273], counts: tags[325] || tags[279],
    rasterType: geoKeys[1025] === 2 ? 'PixelIsPoint' : geoKeys[1025] === 1 ? 'PixelIsArea' : 'unknown',
    tiepoint: tags[33922] ? [tags[33922][3], tags[33922][4]] : null, pixelScale: tags[33550] ? tags[33550].slice(0, 2) : null,
  };
}

function lzwDecode(input, expected) {
  const out = new Uint8Array(expected);
  let o = 0; let bitPos = 0; let width = 9;
  let dict = []; let prev = null;
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict[i] = [i]; dict[256] = null; dict[257] = null; width = 9; };
  const read = () => {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const byte = input[(bitPos + i) >> 3];
      v = (v << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += width;
    return v;
  };
  reset();
  while (o < expected && bitPos + width <= input.length * 8) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { reset(); prev = null; continue; }
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('Bad LZW stream.');
    for (const b of entry) if (o < expected) out[o++] = b;
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length + 1 >= (1 << width) && width < 12) width += 1;
  }
  return out;
}

function decodeBlock(meta, compressed) {
  const { tileWidth: tw, tileHeight: th } = meta;
  const bytesPerSample = meta.bits / 8;
  const expected = tw * th * bytesPerSample;
  let raw;
  if (meta.compression === 8 || meta.compression === 32946) raw = zlib.inflateSync(compressed);
  else if (meta.compression === 5) raw = Buffer.from(lzwDecode(compressed, expected));
  else if (meta.compression === 1) raw = compressed;
  else throw new Error(`Unsupported TIFF compression ${meta.compression}`);
  if (meta.sampleFormat === 3 && meta.bits === 32) {
    const data = new Float32Array(tw * th);
    const rowBytes = tw * 4;
    const tmp = Buffer.alloc(rowBytes);
    for (let row = 0; row < th; row++) {
      const rb = Buffer.from(raw.subarray(row * rowBytes, (row + 1) * rowBytes));
      if (meta.predictor === 3) {
        for (let i = 1; i < rowBytes; i++) rb[i] = (rb[i] + rb[i - 1]) & 0xff;
        for (let i = 0; i < tw; i++) for (let b = 0; b < 4; b++) tmp[i * 4 + b] = rb[b * tw + i];
        for (let i = 0; i < tw; i++) data[row * tw + i] = tmp.readFloatBE(i * 4);
      } else {
        for (let i = 0; i < tw; i++) data[row * tw + i] = rb.readFloatLE(i * 4);
      }
    }
    return data;
  }
  if (meta.bits === 8) {
    const data = new Uint8Array(raw.subarray(0, expected));
    if (meta.predictor === 2) for (let row = 0; row < th; row++) for (let i = 1; i < tw; i++) data[row * tw + i] = (data[row * tw + i] + data[row * tw + i - 1]) & 0xff;
    return data;
  }
  throw new Error(`Unsupported sample layout bits=${meta.bits} format=${meta.sampleFormat}`);
}

// ---------------------------------------------------------------- patches
const tileName = (la, lo) => `N${String(la).padStart(2, '0')}_00_E${String(lo).padStart(3, '0')}_00`;
const demUrl = (t) => `${BUCKET}/Copernicus_DSM_COG_10_${t}_DEM/Copernicus_DSM_COG_10_${t}_DEM.tif`;
const flmUrl = (t) => `${BUCKET}/Copernicus_DSM_COG_10_${t}_DEM/AUXFILES/Copernicus_DSM_COG_10_${t}_FLM.tif`;

function patchGrid(peak) {
  const dLat = HALF_KM / 110.574;
  const dLon = HALF_KM / (111.32 * Math.cos((peak.lat * Math.PI) / 180));
  const latTop = Math.round((peak.lat + dLat) * 3600);
  const lonLeft = Math.round((peak.lon - dLon) * 3600);
  const rows = Math.round(2 * dLat * 3600) + 1;
  const cols = Math.round(2 * dLon * 3600) + 1;
  return { latTopArcsec: latTop, lonLeftArcsec: lonLeft, rows, cols };
}
function locate(latArcsec, lonArcsec) {
  const la = Math.ceil(latArcsec / 3600) - 1;
  const lo = Math.floor(lonArcsec / 3600);
  return { la, lo, r: (la + 1) * 3600 - latArcsec, c: lonArcsec - lo * 3600 };
}

const grids = new Map(OWN_PATCH_PEAKS.map((p) => [p.id, patchGrid(p)]));
// Needed blocks per tile.
const need = new Map();
for (const g of grids.values()) {
  for (let j = 0; j < g.rows; j += 1) {
    for (const i of [0, g.cols - 1, ...Array.from({ length: Math.ceil(g.cols / 256) }, (_, k) => k * 256)]) {
      const loc = locate(g.latTopArcsec - j, g.lonLeftArcsec + i);
      const t = tileName(loc.la, loc.lo);
      if (!need.has(t)) need.set(t, { la: loc.la, lo: loc.lo, blocks: new Set() });
      need.get(t).blocks.add(`${Math.floor(loc.r / 1024)},${Math.floor(loc.c / 1024)}`);
    }
  }
}

const dem = new Map();
const flm = new Map();
const tileReport = {};
for (const [t, info] of [...need].sort()) {
  const header = await getBytes(`GLO-30 DEM header ${t}`, demUrl(t), '0-65535');
  const meta = readIfd0(header);
  if (meta.width !== 3600 || meta.height !== 3600 || meta.rasterType !== 'PixelIsPoint') {
    throw new Error(`${t}: unexpected layout ${meta.width}x${meta.height} ${meta.rasterType}`);
  }
  if (Math.abs(meta.tiepoint[0] - info.lo) > 1e-9 || Math.abs(meta.tiepoint[1] - (info.la + 1)) > 1e-9) throw new Error(`${t}: unexpected tiepoint ${meta.tiepoint}`);
  const across = Math.ceil(meta.width / meta.tileWidth);
  const indices = [...info.blocks].map((k) => { const [by, bx] = k.split(',').map(Number); return by * across + bx; }).sort((a, b) => meta.offsets[a] - meta.offsets[b]);
  // Merge blocks whose byte ranges are contiguous (or within 256 KB).
  const groups = [];
  for (const index of indices) {
    const start = meta.offsets[index];
    const end = start + meta.counts[index] - 1;
    const last = groups.at(-1);
    if (last && start - last.end <= 262144) { last.end = Math.max(last.end, end); last.items.push(index); } else groups.push({ start, end, items: [index] });
  }
  const blocks = new Map();
  for (const group of groups) {
    const bytes = await getBytes(`GLO-30 DEM blocks ${t} [${group.items.join(',')}]`, demUrl(t), `${group.start}-${group.end}`);
    for (const index of group.items) {
      const rel = meta.offsets[index] - group.start;
      blocks.set(index, decodeBlock(meta, bytes.subarray(rel, rel + meta.counts[index])));
    }
  }
  dem.set(t, { meta, blocks, across });
  const flmBytes = await getBytes(`GLO-30 FLM ${t} (whole file)`, flmUrl(t));
  const flmMeta = readIfd0(flmBytes);
  if (flmMeta.width !== 3600 || flmMeta.height !== 3600) throw new Error(`${t}: FLM is ${flmMeta.width}x${flmMeta.height}`);
  const flmAcross = Math.ceil(flmMeta.width / flmMeta.tileWidth);
  flm.set(t, { meta: flmMeta, bytes: flmBytes, across: flmAcross, cache: new Map() });
  tileReport[t] = { demBlocks: indices.length, demRangeRequests: groups.length, demCompression: meta.compression, demPredictor: meta.predictor,
    flm: { compression: flmMeta.compression, predictor: flmMeta.predictor, tile: [flmMeta.tileWidth, flmMeta.tileHeight] } };
}

function sampleDem(latArcsec, lonArcsec) {
  const loc = locate(latArcsec, lonArcsec);
  const tile = dem.get(tileName(loc.la, loc.lo));
  const { tileWidth: tw, tileHeight: th } = tile.meta;
  const block = tile.blocks.get(Math.floor(loc.r / th) * tile.across + Math.floor(loc.c / tw));
  if (!block) throw new Error('block not loaded');
  return block[(loc.r % th) * tw + (loc.c % tw)];
}
function sampleFlm(latArcsec, lonArcsec) {
  const loc = locate(latArcsec, lonArcsec);
  const tile = flm.get(tileName(loc.la, loc.lo));
  const { tileWidth: tw, tileHeight: th } = tile.meta;
  const index = Math.floor(loc.r / th) * tile.across + Math.floor(loc.c / tw);
  if (!tile.cache.has(index)) {
    const start = tile.meta.offsets[index];
    tile.cache.set(index, decodeBlock(tile.meta, tile.bytes.subarray(start, start + tile.meta.counts[index])));
  }
  return tile.cache.get(index)[(loc.r % th) * tw + (loc.c % tw)];
}

const distanceM = (lat1, lon1, lat2, lon2) => {
  const toRad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * toRad) / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(((lon2 - lon1) * toRad) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
};

fs.mkdirSync(ASSET_DIR, { recursive: true });
const patches = {};
const assets = [];
for (const peak of OWN_PATCH_PEAKS) {
  const g = grids.get(peak.id);
  const heights = new Float32Array(g.rows * g.cols);
  let min = Infinity; let max = -Infinity; let voids = 0; let filled = 0;
  let summitMax = -Infinity; let summitAt = null; let filledNearSummit = 0; let nearSummit = 0;
  const sources = {};
  for (let j = 0; j < g.rows; j++) {
    const latArc = g.latTopArcsec - j;
    const lat = latArc / 3600;
    for (let i = 0; i < g.cols; i++) {
      const lonArc = g.lonLeftArcsec + i;
      const lon = lonArc / 3600;
      let h = sampleDem(latArc, lonArc);
      const f = sampleFlm(latArc, lonArc);
      if (!Number.isFinite(h) || h <= -32767 || f === 0) { voids += 1; h = NaN; }
      heights[j * g.cols + i] = h;
      if (Number.isFinite(h)) { if (h < min) min = h; if (h > max) max = h; }
      const isFilled = f >= 3;
      if (isFilled) { filled += 1; sources[FLM_SOURCES[f] || `code ${f}`] = (sources[FLM_SOURCES[f] || `code ${f}`] || 0) + 1; }
      const d = distanceM(peak.lat, peak.lon, lat, lon);
      if (d <= SUMMIT_RADIUS_M && Number.isFinite(h) && h > summitMax) { summitMax = h; summitAt = [lat, lon]; }
      if (d <= FILL_SUMMIT_RADIUS_M) { nearSummit += 1; if (isFilled) filledNearSummit += 1; }
    }
  }
  if (voids) for (let k = 0; k < heights.length; k++) if (!Number.isFinite(heights[k])) heights[k] = min;
  const offset = Math.floor(min / SCALE_M) * SCALE_M;
  const q = new Uint16Array(heights.length);
  let maxError = 0;
  for (let k = 0; k < heights.length; k++) {
    const v = Math.round((heights[k] - offset) / SCALE_M);
    if (v < 0 || v > 65535) throw new Error(`${peak.id}: height out of range`);
    q[k] = v;
    maxError = Math.max(maxError, Math.abs(offset + v * SCALE_M - heights[k]));
  }
  const total = heights.length;
  const fillPercent = +((filled / total) * 100).toFixed(2);
  const fillSummitPercent = +((filledNearSummit / Math.max(1, nearSummit)) * 100).toFixed(1);
  const fillSources = Object.fromEntries(Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +((v / total) * 100).toFixed(2)]));
  const tiles = [...new Set(Array.from({ length: 4 }, (_, k) => {
    const loc = locate(g.latTopArcsec - (k >> 1) * (g.rows - 1), g.lonLeftArcsec + (k & 1) * (g.cols - 1));
    return tileName(loc.la, loc.lo).replace(/_00/g, '');
  }))].sort();
  const keyValues = {
    'LUMI.peakId': peak.id,
    'LUMI.heightOffsetM': String(offset),
    'LUMI.heightScaleM': String(SCALE_M),
    'LUMI.gridLatTopArcsec': String(g.latTopArcsec),
    'LUMI.gridLonLeftArcsec': String(g.lonLeftArcsec),
    'LUMI.gridStepArcsec': '1',
    'LUMI.rasterType': 'PixelIsPoint',
    'LUMI.fillPercent': String(fillPercent),
    'LUMI.fillSummitPercent': String(fillSummitPercent),
    'LUMI.fillSources': JSON.stringify(fillSources),
    'LUMI.source': `Copernicus GLO-30 Public (2021 release, AWS Open Data), tiles ${tiles.join(' ')}, accessed ${accessedFor(peak)}`,
    'LUMI.attribution': 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
  };
  const ktx = encodeKtx2R16({ vkFormat: VK_FORMAT_R16_UNORM, levels: [{ width: g.cols, height: g.rows, data: q }], keyValues });
  const back = decodeKtx2R16F(ktx);
  if (back.vkFormat !== VK_FORMAT_R16_UNORM || back.levels[0].data.some((v, k) => v !== q[k])) throw new Error(`${peak.id}: KTX2 round trip failed`);
  const sha256 = crypto.createHash('sha256').update(ktx).digest('hex');
  const fileName = `glo30-${peak.id}-${sha256.slice(0, 10)}.ktx2`;
  // Exact id match: 'annapurna' must not remove 'annapurna-2' (LOT 7).
  const ownAsset = new RegExp(`^glo30-${peak.id}-[0-9a-f]{10}\\.ktx2$`);
  for (const old of fs.readdirSync(ASSET_DIR)) if (ownAsset.test(old) && old !== fileName) fs.unlinkSync(path.join(ASSET_DIR, old));
  fs.writeFileSync(path.join(ASSET_DIR, fileName), ktx);
  assets.push({ file: `assets/himalaya/${fileName}`, bytes: ktx.length, sha256 });
  patches[peak.id] = {
    file: `assets/himalaya/${fileName}`, bytes: ktx.length, sha256,
    rows: g.rows, cols: g.cols, latTopArcsec: g.latTopArcsec, lonLeftArcsec: g.lonLeftArcsec, stepArcsec: 1,
    heightOffsetM: offset, heightScaleM: SCALE_M, minM: +min.toFixed(2), maxM: +max.toFixed(2),
    demSummitM: +summitMax.toFixed(2), demSummitAt: summitAt.map((v) => +v.toFixed(6)), demSummitRadiusM: SUMMIT_RADIUS_M,
    fillPercent, fillSummitPercent, fillSummitRadiusM: FILL_SUMMIT_RADIUS_M, fillSources, voidPixels: voids, tiles,
    maxQuantizationErrorM: +maxError.toFixed(4),
    ...(peak.group === 'selected-nepal' ? { accessed: accessedFor(peak) } : {}),
  };
}

// Peaks on a shared patch (LOT 7): summit values on their own point.
const sharedPoints = {};
for (const peak of SHARED_PATCH_PEAKS) {
  const g = grids.get(peak.patchOf);
  let summitMax = -Infinity; let summitAt = null; let filledNearSummit = 0; let nearSummit = 0;
  for (let j = 0; j < g.rows; j++) {
    const latArc = g.latTopArcsec - j;
    for (let i = 0; i < g.cols; i++) {
      const lonArc = g.lonLeftArcsec + i;
      const d = distanceM(peak.lat, peak.lon, latArc / 3600, lonArc / 3600);
      if (d > FILL_SUMMIT_RADIUS_M) continue;
      const h = sampleDem(latArc, lonArc);
      const f = sampleFlm(latArc, lonArc);
      nearSummit += 1; if (f >= 3) filledNearSummit += 1;
      if (d <= SUMMIT_RADIUS_M && Number.isFinite(h) && h > -32767 && f !== 0 && h > summitMax) { summitMax = h; summitAt = [latArc / 3600, lonArc / 3600]; }
    }
  }
  if (!summitAt) throw new Error(`${peak.id}: no DEM sample near the summit in the ${peak.patchOf} patch`);
  sharedPoints[peak.id] = {
    patchOf: peak.patchOf, demSummitM: +summitMax.toFixed(2), demSummitAt: summitAt.map((v) => +v.toFixed(6)), demSummitRadiusM: SUMMIT_RADIUS_M,
    fillSummitPercent: +((filledNearSummit / Math.max(1, nearSummit)) * 100).toFixed(1), fillSummitRadiusM: FILL_SUMMIT_RADIUS_M,
    // no `accessed`: the data are those of the shared patch (its access date applies)
  };
}
const isSelected = (id) => HIMALAYA_SELECTED_PEAKS.some((p) => p.id === id);
const unchanged = HIMALAYA_PEAKS.map((p) => ({ id: p.id, sameAsBefore: previousConfig.HIMALAYA_TERRAIN_PATCHES?.[p.id]?.sha256 === patches[p.id].sha256 }));

const banner = `// GENERATED by tools/build-himalaya-patches.mjs on ${ACCESSED} - do not edit by hand.
// Copernicus GLO-30 terrain patches (20 x 20 km, 1 arc-second, RasterPixelIsPoint)
// around the 14 summits and the selected Nepal peaks (LOT 7): R16_UNORM heights,
// q = round((h - heightOffsetM) / heightScaleM). A selected peak with patchOf
// shares that patch; its demSummit* and fillSummit* are computed on its own point.
// demSummitM = highest DEM sample within demSummitRadiusM of the summit coordinates
// (a model value: DEM != survey). fillPercent = share of patch pixels that the
// GLO-30 Filling Mask flags as filled from another source (FLM >= 3);
// fillSummitPercent = the same within fillSummitRadiusM of the summit.
`;
const body = `${banner}
export const GLO30_ACCESSED = '${ACCESSED_14}';
export const GLO30_SELECTED_ACCESSED = '${ACCESSED}';
export const GLO30_RELEASE = 'GLO-30 Public, 2021 release (AWS Open Data)';
export const GLO30_ATTRIBUTION = 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';

// The 14 eight-thousanders (one patch each).
export const HIMALAYA_TERRAIN_PATCHES = Object.freeze({
${Object.entries(patches).filter(([id]) => !isSelected(id)).map(([id, p]) => `  '${id}': Object.freeze(${JSON.stringify(p)}),`).join('\n')}
});

// Selected Nepal peaks with a patch of their own.
export const HIMALAYA_SELECTED_TERRAIN_PATCHES = Object.freeze({
${Object.entries(patches).filter(([id]) => isSelected(id)).map(([id, p]) => `  '${id}': Object.freeze(${JSON.stringify(p)}),`).join('\n')}
});

// Selected peaks on a shared patch: own summit values, the patch of patchOf.
export const HIMALAYA_SHARED_PATCH_POINTS = Object.freeze({
${Object.entries(sharedPoints).map(([id, p]) => `  '${id}': Object.freeze(${JSON.stringify(p)}),`).join('\n')}
});

const merged = new Map();
/** Patch metadata for any of the 20 peaks (a shared patch carries patchOf and the peak's own summit values), or null. */
export function getTerrainPatch(id) {
  if (Object.hasOwn(HIMALAYA_TERRAIN_PATCHES, id)) return HIMALAYA_TERRAIN_PATCHES[id];
  if (Object.hasOwn(HIMALAYA_SELECTED_TERRAIN_PATCHES, id)) return HIMALAYA_SELECTED_TERRAIN_PATCHES[id];
  if (!Object.hasOwn(HIMALAYA_SHARED_PATCH_POINTS, id)) return null;
  if (!merged.has(id)) {
    const point = HIMALAYA_SHARED_PATCH_POINTS[id];
    merged.set(id, Object.freeze({ ...HIMALAYA_TERRAIN_PATCHES[point.patchOf], ...point }));
  }
  return merged.get(id);
}

/** The id under which the patch mesh of a peak is loaded (the shared patch for patchOf). */
export function patchKeyOf(id) {
  return Object.hasOwn(HIMALAYA_SHARED_PATCH_POINTS, id) ? HIMALAYA_SHARED_PATCH_POINTS[id].patchOf : id;
}
`;
fs.writeFileSync(CONFIG_OUT, body);
const report = { accessed: ACCESSED, accessedEightThousanders: ACCESSED_14, networkRequestsThisRun: networkRequests, totalLoggedRequests: log.requests.length, tiles: tileReport,
  assets, totalBytes: assets.reduce((s, a) => s + a.bytes, 0), patches, sharedPoints, unchanged };
fs.writeFileSync(REPORT_OUT, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ networkRequestsThisRun: networkRequests, totalLoggedRequests: log.requests.length, totalBytes: report.totalBytes, sharedPoints,
  eightThousandersUnchanged: unchanged.every((u) => u.sameAsBefore) ? 14 : unchanged.filter((u) => !u.sameAsBefore).map((u) => u.id),
  patches: Object.fromEntries(Object.entries(patches).map(([id, p]) => [id, { kb: Math.round(p.bytes / 1024), dem: p.demSummitM, fill: p.fillPercent, fillSummit: p.fillSummitPercent, voids: p.voidPixels, err: p.maxQuantizationErrorM }])) }, null, 1));
