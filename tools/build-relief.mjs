#!/usr/bin/env node
// Builds the linear relief and the water mask used by Living Earth (LOT 4b-B).
//
//   node tools/build-relief.mjs            # build everything (downloads once)
//   node tools/build-relief.mjs --check    # verify the source only
//
// Inputs (downloaded once into tmp/lot4b/source/, git-ignored):
//   - NOAA NCEI ETOPO 2022 60" ICE SURFACE GeoTIFF (ETOPO_2022_v1_60s_N90W180_surface.tif),
//     DOI 10.25921/fd45-gt74: the top of the Greenland/Antarctic ice sheets,
//     identical to bedrock elsewhere. Size and SHA-256 are checked; never re-downloaded.
//   - NASA GIBS WMTS MODIS_Water_Mask (MOD44W, MODIS/SRTM), EPSG:4326 250m set,
//     level 5 = 40 x 20 tiles of 9 deg (512 px), i.e. 20480 x 10240 px.
// Outputs (assets/):
//   - etopo2022-surface-m-2160x1080.ktx2      R16_SFLOAT metres + Zstd, 12 mip levels
//   - etopo2022-surface-m-2160x1080.r16f.bin  same level 0, raw little-endian half floats
//   - etopo2022-surface-m-2160x1080.json      metadata of both (the .bin has no header)
//   - mod44w-water-2160x1080.png              8-bit water FRACTION per texel (0..255),
//                                             decoded to an R8 texture at runtime
// ETOPO holds no lake levels: lake surfaces are rendered at 0 m by the app.
// Relief rows are stored south first (uv.y = 0 at the south pole, flipY=false);
// the PNG is north first (TextureLoader flipY=true), so both map to the same uv.
// Method: area average, not point sampling. Each 1/6 deg texel is the mean of
// the 10 x 10 source cells it contains, weighted by cos(latitude) (cell area).
// The water fraction is the area-weighted share of MOD44W water pixels that
// overlap the texel (exact fractional overlaps), not a majority vote.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromFile } from 'geotiff';
import { buildMipChain, decodeKtx2R16F, encodeKtx2R16F, fromHalfBits, toHalfBits } from './lib/ktx2-r16f.mjs';
import { decodePngIndexed, encodePngGray8 } from './lib/png.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCE_DIR = path.join(root, 'tmp', 'lot4b', 'source');
const ASSETS = path.join(root, 'assets');
const REPORT = path.join(root, 'tmp', 'lot4b', 'build-relief-report.json');
const ETOPO = Object.freeze({
    url: 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif',
    file: path.join(SOURCE_DIR, 'ETOPO_2022_v1_60s_N90W180_surface.tif'),
    bytes: 465969062,
    // SHA-256 of the file served by NCEI on 2026-11-13 (Last-Modified 2022-10-04).
    sha256: '9d27d4b8ea8e76977e2988bca667d7c8fa68b927355feffcddd6b4875a7fd08e',
    doi: '10.25921/fd45-gt74',
});
const OUT = Object.freeze({ width: 2160, height: 1080, block: 10 });
const MASK = Object.freeze({
    layer: 'MODIS_Water_Mask', matrixSet: '250m', z: 5, columns: 40, rows: 20, tileSize: 512, tileSpanDeg: 9,
    cacheDir: path.join(SOURCE_DIR, 'mod44w-250m-z5'),
    waterIndex: 1, // palette entry 1 = water (opaque); 0 = transparent = not water
});
const PROBES = Object.freeze({
    everest: { lon: 86.925, lat: 27.988 },
    deadSea: { lon: 35.5, lat: 31.5 },
    mariana: { lon: 142.2, lat: 11.35 },
    baikal: { lon: 108.0, lat: 53.5 },
    qattara: { lon: 27.1, lat: 29.6 },
    caspian: { lon: 51.0, lat: 42.0 },
    lakeSuperior: { lon: -87.5, lat: 47.6 },
    southernOcean: { lon: 0, lat: -65 },
    arcticOcean: { lon: 0, lat: 85 },
    antarcticaInterior: { lon: 0, lat: -80 },
    greenlandInterior: { lon: -40, lat: 72 },
    vostok: { lon: 106.84, lat: -78.46 },
});

const args = new Set(process.argv.slice(2));
const log = (...m) => console.log('[build-relief]', ...m);

async function sha256(file) {
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => fs.createReadStream(file).on('data', (c) => hash.update(c)).on('end', resolve).on('error', reject));
    return hash.digest('hex');
}

async function ensureEtopo() {
    fs.mkdirSync(SOURCE_DIR, { recursive: true });
    if (!fs.existsSync(ETOPO.file) || fs.statSync(ETOPO.file).size !== ETOPO.bytes) {
        log(`downloading ${ETOPO.url} (${(ETOPO.bytes / 1e6).toFixed(0)} MB)`);
        const response = await fetch(ETOPO.url);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${ETOPO.url}`);
        const partial = `${ETOPO.file}.partial`;
        const out = fs.createWriteStream(partial);
        for await (const chunk of response.body) out.write(chunk);
        await new Promise((resolve) => out.end(resolve));
        fs.renameSync(partial, ETOPO.file);
    }
    const size = fs.statSync(ETOPO.file).size;
    if (size !== ETOPO.bytes) throw new Error(`ETOPO source is ${size} bytes, expected ${ETOPO.bytes}`);
    const digest = await sha256(ETOPO.file);
    const expected = ETOPO.sha256;
    if (expected && digest !== expected) throw new Error(`ETOPO source SHA-256 ${digest} != expected ${expected}`);
    log(`source ok: ${size} bytes, sha256 ${digest}${expected ? ' (matches pinned)' : ' (not pinned yet)'}`);
    return digest;
}

// Area-weighted 10 x 10 block mean, read in bands of whole output rows.
async function areaAverageEtopo() {
    const tiff = await fromFile(ETOPO.file);
    const image = await tiff.getImage();
    const W = image.getWidth();
    const H = image.getHeight();
    const [west, south, east, north] = image.getBoundingBox();
    const noData = image.getGDALNoData();
    if (W !== OUT.width * OUT.block || H !== OUT.height * OUT.block) throw new Error(`unexpected source size ${W}x${H}`);
    log(`source ${W}x${H}, bbox ${west},${south},${east},${north}, nodata ${noData}, tile ${image.getTileWidth()}x${image.getTileHeight()}`);
    const out = new Float32Array(OUT.width * OUT.height); // north first
    const blockMin = new Float32Array(out.length);
    const blockMax = new Float32Array(out.length);
    const bandRows = 54; // output rows per read (540 source rows)
    let skipped = 0;
    for (let r0 = 0; r0 < OUT.height; r0 += bandRows) {
        const rows = Math.min(bandRows, OUT.height - r0);
        const [band] = await image.readRasters({ window: [0, r0 * OUT.block, W, (r0 + rows) * OUT.block], samples: [0] });
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < OUT.width; c++) {
                let sum = 0; let weight = 0; let min = Infinity; let max = -Infinity;
                for (let dy = 0; dy < OUT.block; dy++) {
                    const sy = (r * OUT.block + dy);
                    const lat = north - ((r0 * OUT.block + sy) + 0.5) * (north - south) / H;
                    const w = Math.cos(lat * Math.PI / 180);
                    for (let dx = 0; dx < OUT.block; dx++) {
                        const v = band[sy * W + c * OUT.block + dx];
                        if (noData !== null && v === noData) { skipped++; continue; }
                        sum += v * w; weight += w;
                        if (v < min) min = v;
                        if (v > max) max = v;
                    }
                }
                const k = (r0 + r) * OUT.width + c;
                out[k] = weight > 0 ? sum / weight : 0;
                blockMin[k] = min; blockMax[k] = max;
            }
        }
        if (r0 % 270 === 0) log(`relief rows ${r0}..${r0 + rows - 1}`);
    }
    return { out, blockMin, blockMax, image, skipped, bbox: [west, south, east, north] };
}

async function sourceValueAt(image, bbox, lon, lat) {
    const W = image.getWidth(); const H = image.getHeight();
    const x = Math.min(W - 1, Math.floor((lon - bbox[0]) / (bbox[2] - bbox[0]) * W));
    const y = Math.min(H - 1, Math.floor((bbox[3] - lat) / (bbox[3] - bbox[1]) * H));
    const [v] = await image.readRasters({ window: [x, y, x + 1, y + 1], samples: [0] });
    return v[0];
}

async function fetchMaskTile(row, col) {
    const file = path.join(MASK.cacheDir, `${row}_${col}.png`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
    const url = `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${MASK.layer}/default/default/${MASK.matrixSet}/${MASK.z}/${row}/${col}.png`;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(file, buffer);
            return buffer;
        } catch (error) {
            if (attempt === 2) throw new Error(`${url}: ${error.message}`);
        }
    }
    return null;
}

// Exact 1-D overlaps of source pixels (size s deg) with output texels (size t deg).
function overlaps(sourceCount, sourceSize, outCount, outSize) {
    const first = new Int32Array(sourceCount); const w0 = new Float64Array(sourceCount); const w1 = new Float64Array(sourceCount);
    for (let i = 0; i < sourceCount; i++) {
        const a = i * sourceSize; const b = a + sourceSize;
        const o = Math.min(outCount - 1, Math.floor(a / outSize));
        const edge = (o + 1) * outSize;
        first[i] = o;
        if (b <= edge + 1e-12 || o === outCount - 1) { w0[i] = (Math.min(b, edge) - a) / outSize; w1[i] = 0; }
        else { w0[i] = (edge - a) / outSize; w1[i] = (b - edge) / outSize; }
    }
    return { first, w0, w1 };
}

async function buildWaterFraction() {
    fs.mkdirSync(MASK.cacheDir, { recursive: true });
    const outSize = 1 / 6; const srcSize = MASK.tileSpanDeg / MASK.tileSize;
    const pxW = MASK.columns * MASK.tileSize; const pxH = MASK.rows * MASK.tileSize;
    const X = overlaps(pxW, srcSize, OUT.width, outSize);
    const Y = overlaps(pxH, srcSize, OUT.height, outSize);
    const fraction = new Float64Array(OUT.width * OUT.height);
    const jobs = [];
    for (let row = 0; row < MASK.rows; row++) for (let col = 0; col < MASK.columns; col++) jobs.push([row, col]);
    let next = 0; let done = 0; let waterPixels = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const [row, col] = jobs[next++];
            const tile = decodePngIndexed(await fetchMaskTile(row, col));
            for (let ty = 0; ty < MASK.tileSize; ty++) {
                const gy = row * MASK.tileSize + ty;
                if (gy >= pxH) break;
                for (let tx = 0; tx < MASK.tileSize; tx++) {
                    if (tile.indices[ty * MASK.tileSize + tx] !== MASK.waterIndex) continue;
                    waterPixels++;
                    const gx = col * MASK.tileSize + tx;
                    const r = Y.first[gy]; const c = X.first[gx];
                    fraction[r * OUT.width + c] += Y.w0[gy] * X.w0[gx];
                    if (X.w1[gx]) fraction[r * OUT.width + c + 1] += Y.w0[gy] * X.w1[gx];
                    if (Y.w1[gy]) {
                        fraction[(r + 1) * OUT.width + c] += Y.w1[gy] * X.w0[gx];
                        if (X.w1[gx]) fraction[(r + 1) * OUT.width + c + 1] += Y.w1[gy] * X.w1[gx];
                    }
                }
            }
            if (++done % 100 === 0) log(`water mask tiles ${done}/${jobs.length}`);
        }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    const bytes = new Uint8Array(fraction.length);
    for (let i = 0; i < fraction.length; i++) bytes[i] = Math.round(Math.min(1, Math.max(0, fraction[i])) * 255);
    return { bytes, waterPixels, tiles: jobs.length, pixels: `${pxW}x${pxH}` };
}

function flipRows(data, width, height) {
    const out = new data.constructor(data.length);
    for (let y = 0; y < height; y++) out.set(data.subarray(y * width, (y + 1) * width), (height - 1 - y) * width);
    return out;
}

const texelOf = (lon, lat) => ({ c: Math.min(OUT.width - 1, Math.floor((lon + 180) * 6)), r: Math.min(OUT.height - 1, Math.floor((90 - lat) * 6)) });

const sourceDigest = await ensureEtopo();
if (args.has('--check')) process.exit(0);

const started = Date.now();
const relief = await areaAverageEtopo();
const water = await buildWaterFraction();
log(`computed in ${((Date.now() - started) / 1000).toFixed(1)} s`);

const metadata = {
    product: 'NOAA NCEI ETOPO 2022 Global Relief Model, 60 arc-second ice surface elevation (bedrock outside the ice sheets)',
    doi: ETOPO.doi,
    sourceUrl: ETOPO.url,
    sourceSha256: sourceDigest,
    units: 'metres above mean sea level (EGM2008 geoid), negative below',
    grid: `${OUT.width}x${OUT.height}, 1/6 deg texels, cell-registered, lon -180..180`,
    method: 'area average: cos(latitude)-weighted mean of the 10x10 source cells in each texel',
    rows: 'south first (uv.y = 0 at the south pole)',
    encoding: 'IEEE 754 half float (R16F), little-endian',
    builtBy: 'tools/build-relief.mjs',
};
const southFirst = flipRows(relief.out, OUT.width, OUT.height);
const mips = buildMipChain(southFirst, OUT.width, OUT.height);
const ktx2 = encodeKtx2R16F({
    levels: mips.map((m) => ({ width: m.width, height: m.height, data: toHalfBits(m.data) })),
    keyValues: Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`LEA_${k}`, v])),
});
const level0 = toHalfBits(southFirst);
fs.writeFileSync(path.join(ASSETS, 'etopo2022-surface-m-2160x1080.ktx2'), ktx2);
fs.writeFileSync(path.join(ASSETS, 'etopo2022-surface-m-2160x1080.r16f.bin'), Buffer.from(level0.buffer));
fs.writeFileSync(path.join(ASSETS, 'etopo2022-surface-m-2160x1080.json'), `${JSON.stringify({ ...metadata, files: {
    ktx2: 'etopo2022-surface-m-2160x1080.ktx2 (VK_FORMAT_R16_SFLOAT, Zstd, 12 mip levels)',
    bin: 'etopo2022-surface-m-2160x1080.r16f.bin (level 0 only, no header)',
}, notes: {
    lakes: 'lake surfaces rendered at 0 m (ETOPO has no lake levels)',
} }, null, 2)}\n`);
const maskPng = encodePngGray8({
    width: OUT.width, height: OUT.height, data: water.bytes,
    text: {
        Source: `NASA GIBS WMTS ${MASK.layer} (MOD44W, MODIS/SRTM water mask), EPSG:4326 ${MASK.matrixSet} level ${MASK.z}, ${water.tiles} tiles (${water.pixels} px)`,
        Transform: 'water fraction per 1/6 deg texel: exact area-weighted share of water pixels (0 = land, 255 = water); rows north first',
        Builder: 'tools/build-relief.mjs',
    },
});
fs.writeFileSync(path.join(ASSETS, 'mod44w-water-2160x1080.png'), maskPng);

// Verification: read the KTX2 back and compare with the float source.
const back = decodeKtx2R16F(ktx2);
const back0 = fromHalfBits(back.levels[0].data);
let maxHalfError = 0;
for (let i = 0; i < southFirst.length; i++) maxHalfError = Math.max(maxHalfError, Math.abs(back0[i] - southFirst[i]));
const probes = {};
for (const [name, p] of Object.entries(PROBES)) {
    const { c, r } = texelOf(p.lon, p.lat);
    const k = r * OUT.width + c;
    const texel = relief.out[k];
    const stored = back0[(OUT.height - 1 - r) * OUT.width + c];
    const source = await sourceValueAt(relief.image, relief.bbox, p.lon, p.lat);
    probes[name] = {
        lon: p.lon, lat: p.lat, sourceAtPointM: Math.round(source), texelAreaMeanM: Math.round(texel), storedHalfM: Math.round(stored),
        texelSourceMinM: Math.round(relief.blockMin[k]), texelSourceMaxM: Math.round(relief.blockMax[k]),
        meanMinusPointM: Math.round(texel - source), halfMinusMeanM: +(stored - texel).toFixed(2),
        waterFraction: +(water.bytes[k] / 255).toFixed(3), classified: water.bytes[k] >= 128 ? 'water' : 'land',
    };
}
const report = {
    builtAt: new Date().toISOString(), metadata, skippedNoDataCells: relief.skipped,
    sizes: Object.fromEntries(['etopo2022-surface-m-2160x1080.ktx2', 'etopo2022-surface-m-2160x1080.r16f.bin', 'mod44w-water-2160x1080.png']
        .map((f) => [f, fs.statSync(path.join(ASSETS, f)).size])),
    ktx2: { levels: back.levels.length, vkFormat: back.vkFormat, maxHalfErrorM: +maxHalfError.toFixed(3) },
    range: relief.out.reduce((acc, v) => ({ minM: Math.min(acc.minM, Math.round(v)), maxM: Math.max(acc.maxM, Math.round(v)) }), { minM: Infinity, maxM: -Infinity }),
    water: { tiles: water.tiles, sourcePixels: water.pixels, waterPixels: water.waterPixels,
        texelsWater: water.bytes.filter((v) => v === 255).length, texelsLand: water.bytes.filter((v) => v === 0).length,
        texelsMixed: water.bytes.filter((v) => v > 0 && v < 255).length },
    probes,
};
fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
log(JSON.stringify({ sizes: report.sizes, ktx2: report.ktx2, range: report.range, water: report.water }, null, 1));
for (const [name, p] of Object.entries(probes)) log(name, JSON.stringify(p));
