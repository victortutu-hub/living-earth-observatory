// LOT 30: tangent-space normal map of the Moon from the LOLA topography of the NASA SVS CGI Moon Kit
// (https://svs.gsfc.nasa.gov/4720; credit: NASA's Scientific Visualization Studio).
// Input: ldem_16_uint.tif, 5760x2880 (16 px per degree), unsigned 16-bit in half-metres relative to a
// radius of 1727400 m (SVS: "offset by +20,000 (10 km) so that all of the values are positive").
// Height above the 1737.4 km reference sphere: h_m = value * 0.5 - 10000.
// Method (deterministic, float64):
//  1. Box-filter (area-weighted) resampling of the heights to OUT_W x OUT_H (4096x2048).
//  2. Central differences in metres over the true ground distance of one output pixel:
//       north-south step  dy = pi * R / OUT_H            = 2.665 km per pixel (R = 1737.4 km)
//       east-west step    dx = 2 * pi * R * cos(lat) / OUT_W  (2.665 km at the equator)
//     Near the poles dx shrinks to metres while the resampled heights there are interpolated, which
//     would turn interpolation noise into steep slopes: dx is clamped at MIN_DX_FRACTION * dy (only
//     where |lat| > about 75.5 deg). This is the one non-physical step; it is recorded in the config.
//  3. n = normalize(-dh/dx * V, -dh/dy * V, 1) with the vertical exaggeration V = 1 (none);
//     tangent = east (+u of the equirectangular UV), bitangent = north (+v), i.e. the OpenGL / three.js
//     convention. Encoded as RGB = (n * 0.5 + 0.5) * 255, baseline JPEG 4:4:4.
// Output: assets/moon/moon-lola-normal-4k-<hash10>.jpg + src/config/moon-normal.js.
// Representation: reconstructed (surface orientation computed from measured topography).
// Usage: node tools/build-moon-normal.mjs   (reads tmp/lot30/raw/svs/ldem_16_uint.tif; no network)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';
import { encodeJpeg } from './lib/jpeg-encode.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const SOURCE = path.join(ROOT, 'tmp/lot30/raw/svs/ldem_16_uint.tif');
const SOURCE_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif';
const SOURCE_SHA256 = '45a2b32d56e81ed30db07fead8abc842b249b6511219d9ca2c53f81bc2dc5d62';
const SOURCE_BYTES = 33201026;
const ASSET_DIR = path.join(ROOT, 'assets/moon');
const CONFIG_OUT = path.join(ROOT, 'src/config/moon-normal.js');
export const OUT_W = 4096;
export const OUT_H = 2048;
export const MOON_RADIUS_M = 1737400;
export const VERTICAL_EXAGGERATION = 1;
export const MIN_DX_FRACTION = 0.25;
export const QUALITY = 95;

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const input = fs.readFileSync(SOURCE);
if (input.length !== SOURCE_BYTES || sha256(input) !== SOURCE_SHA256) throw new Error('ldem_16_uint.tif: size or SHA-256 differs from the approved input');
const tiff = await fromArrayBuffer(input.buffer.slice(input.byteOffset, input.byteOffset + input.length));
const image = await tiff.getImage(0);
const SW = image.getWidth(); const SH = image.getHeight();
if (SW !== 5760 || SH !== 2880 || image.getSamplesPerPixel() !== 1) throw new Error(`unexpected raster ${SW}x${SH}`);
const [raw] = await image.readRasters();
if (!(raw instanceof Uint16Array)) throw new Error('expected unsigned 16-bit samples');

// 1. Area-weighted resampling (separable box filter).
function boxWeights(srcN, dstN) {
  const scale = srcN / dstN; const list = [];
  for (let i = 0; i < dstN; i++) {
    const a = i * scale; const b = (i + 1) * scale; const w = [];
    for (let s = Math.floor(a); s < Math.ceil(b); s++) { const overlap = Math.min(b, s + 1) - Math.max(a, s); if (overlap > 0) w.push([s, overlap / scale]); }
    list.push(w);
  }
  return list;
}
const wx = boxWeights(SW, OUT_W); const wy = boxWeights(SH, OUT_H);
const rows = new Float64Array(SH * OUT_W);
for (let y = 0; y < SH; y++) for (let x = 0; x < OUT_W; x++) { let s = 0; for (const [sx, w] of wx[x]) s += w * (raw[y * SW + sx] * 0.5 - 10000); rows[y * OUT_W + x] = s; }
const height = new Float64Array(OUT_W * OUT_H);
for (let y = 0; y < OUT_H; y++) for (let x = 0; x < OUT_W; x++) { let s = 0; for (const [sy, w] of wy[y]) s += w * rows[sy * OUT_W + x]; height[y * OUT_W + x] = s; }

// 2-3. Gradients and normals.
const dy = (Math.PI * MOON_RADIUS_M) / OUT_H;
const rgb = new Uint8Array(OUT_W * OUT_H * 3);
const stats = { minM: Infinity, maxM: -Infinity, maxSlopeDeg: 0, over15deg: 0, over30deg: 0, clampedRows: 0 };
const toByte = (v) => Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
for (let y = 0; y < OUT_H; y++) {
  const lat = (90 - ((y + 0.5) * 180) / OUT_H) * (Math.PI / 180);
  const dxTrue = (2 * Math.PI * MOON_RADIUS_M * Math.cos(lat)) / OUT_W;
  const dx = Math.max(dxTrue, MIN_DX_FRACTION * dy);
  if (dx !== dxTrue) stats.clampedRows++;
  const yn = Math.max(0, y - 1); const ys = Math.min(OUT_H - 1, y + 1);
  for (let x = 0; x < OUT_W; x++) {
    const h = height[y * OUT_W + x];
    if (h < stats.minM) stats.minM = h; if (h > stats.maxM) stats.maxM = h;
    const e = height[y * OUT_W + ((x + 1) % OUT_W)]; const w = height[y * OUT_W + ((x - 1 + OUT_W) % OUT_W)];
    const dhdx = (e - w) / (2 * dx);
    const dhdy = (height[yn * OUT_W + x] - height[ys * OUT_W + x]) / ((ys - yn) * dy); // + = rising to the north
    let nx = -dhdx * VERTICAL_EXAGGERATION; let ny = -dhdy * VERTICAL_EXAGGERATION; let nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const slope = Math.acos(nz) * (180 / Math.PI);
    if (slope > stats.maxSlopeDeg) stats.maxSlopeDeg = slope; if (slope > 15) stats.over15deg++; if (slope > 30) stats.over30deg++;
    const i = (y * OUT_W + x) * 3; rgb[i] = toByte(nx); rgb[i + 1] = toByte(ny); rgb[i + 2] = toByte(nz);
  }
}

const jpeg = encodeJpeg({ width: OUT_W, height: OUT_H, data: rgb, channels: 3, quality: QUALITY });
const hash = sha256(jpeg);
const fileName = `moon-lola-normal-4k-${hash.slice(0, 10)}.jpg`;
fs.mkdirSync(ASSET_DIR, { recursive: true });
for (const old of fs.readdirSync(ASSET_DIR)) if (/^moon-lola-normal-4k-[0-9a-f]{10}\.jpg$/.test(old) && old !== fileName) fs.unlinkSync(path.join(ASSET_DIR, old));
fs.writeFileSync(path.join(ASSET_DIR, fileName), jpeg);

const round = (v, d = 3) => Number(v.toFixed(d));
const asset = {
  file: `assets/moon/${fileName}`, sha256: hash, bytes: jpeg.length, width: OUT_W, height: OUT_H, format: `JPEG baseline 4:4:4, quality ${QUALITY} (tools/lib/jpeg-encode.mjs)`,
  representation: 'reconstructed', convention: 'tangent space, OpenGL (+X east, +Y north), RGB = n * 0.5 + 0.5',
  scale: { kmPerPixelNS: round(dy / 1000), kmPerPixelEWEquator: round((2 * Math.PI * MOON_RADIUS_M) / OUT_W / 1000), heightUnit: 'm above the 1737.4 km sphere', verticalExaggeration: VERTICAL_EXAGGERATION, minDxFraction: MIN_DX_FRACTION, clampedRows: stats.clampedRows },
  stats: { heightMinM: round(stats.minM, 1), heightMaxM: round(stats.maxM, 1), maxSlopeDeg: round(stats.maxSlopeDeg, 2), pixelsOver15deg: stats.over15deg, pixelsOver30deg: stats.over30deg },
  source: { name: 'NASA SVS CGI Moon Kit (ID 4720), LOLA LDEM 16 px/deg (ldem_16_uint)', url: SOURCE_URL, page: 'https://svs.gsfc.nasa.gov/4720', sha256: SOURCE_SHA256, bytes: SOURCE_BYTES, credit: "NASA's Scientific Visualization Studio", tool: 'tools/build-moon-normal.mjs' },
};
fs.writeFileSync(CONFIG_OUT, `// GENERATED by tools/build-moon-normal.mjs - do not edit by hand.
// LOT 30: Moon normal map reconstructed from LOLA topography (NASA SVS CGI Moon Kit), vertical exaggeration 1x.
export const MOON_NORMAL_ASSET = Object.freeze(${JSON.stringify(asset)});
`);
console.log(JSON.stringify({ file: asset.file, bytes: asset.bytes, sha256: hash, scale: asset.scale, stats: asset.stats }));
