// LOT 15: the Milky Way background of the real sky, from NASA SVS Deep Star
// Maps 2020 (svs.gsfc.nasa.gov/4851): milkyway_2020_4k.exr (the map without the
// Hipparcos and Tycho stars), calibrated against hiptyc_2020_4k.exr (the bright
// star layer, local only). No network; reads tmp/sky/.
//   1. Calibration: aperture photometry of isolated, NON-saturated HYG Hipparcos
//      stars on hiptyc_2020 (no pixel >= 0.98 in the window), V in CAL_RANGE:
//      minst = -2.5 log10(sum (Y - bg) cos dec) ; ZP = median(minst - V).
//   2. Background: surface brightness mu = -2.5 log10(Y) + 2.5 log10(Omega_eq) - ZP
//      (mag/arcsec^2, Omega_eq = equatorial pixel solid angle); pixels clipped at
//      1.0 are counted and located, not repaired.
//   3. Duplicate check: no background peak at the point-star positions.
//   4. Exposure: scene value = L / L_REF * 2^N, N = the largest integer keeping
//      the brightest background texel below the lowest Earth bloom threshold.
//   5. Cube maps (GL convention, lookup vector = ICRS), 2x2 supersampled
//      bilinear, box-filtered mips in linear space: luminance 6 x 1024^2 as
//      8-bit log codes (KTX2 R8 + Zstd) and chromaticity 6 x 256^2 (KTX2 RG8 +
//      Zstd); decoding in src/core/sky/sky-encoding.js. Budget: <= 8 MiB.
// Usage: node tools/build-sky-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readExr } from './lib/exr-zip.mjs';
import { readHygHipparcos } from './lib/hyg-catalog.mjs';
import { LUMA, equirectPixel, equirectRaDec, fitMagnitudes, measureStars } from './lib/sky-calibration.mjs';
import { encodeKtx2Cube, VK_FORMAT_R8_UNORM, VK_FORMAT_R8G8_UNORM } from './lib/ktx2-cube.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { cubeFaceDirection, normalize, vectorToRaDec } = await load('src/core/sky/sky-frame.js');
const { LOG_MIN_STOPS, QUANTISATION_ERROR_MAG, encodeSkyValue, encodeChromaticity } = await load('src/core/sky/sky-encoding.js');

const TMP = path.join(ROOT, 'tmp/sky');
const SOURCES = {
  milkyway: { file: 'milkyway_2020_4k.exr', bytes: 36436668, url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_4k.exr' },
  hiptyc: { file: 'hiptyc_2020_4k.exr', bytes: 21251204, url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/hiptyc_2020_4k.exr' },
  hyg: { file: 'hyg_v44.csv.gz', sha256: '00b349893b9a53106dd488d8371e8d2fa586043e500bb3cdb8bff3931682197d' },
};
const CAL_RANGE = [4, 6.5];
const STAR_LIMIT = 6.5;
const CUBE_SIZE = 1024;
const CHROMA_SIZE = 256; // colour varies on large scales (dust, star clouds); 256^2 per face ~ 0.35 deg
const MAX_BYTES = 8 * 1024 * 1024;
const L_REF_CDM2 = 4.0e4; // Earth exposure reference: scene value 1.0 = white Lambertian surface under the Sun at 1 AU (E = 1.27e5 lx -> E/pi)
const MIN_BLOOM_THRESHOLD = 0.18; // lowest bloomThreshold among the Earth looks/moods (src/earth/earth-appearance.js)
const ASSET_DIR = path.join(ROOT, 'assets/sky');
const CONFIG_OUT = path.join(ROOT, 'src/config/sky-map.js');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

const files = Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => {
  const buf = fs.readFileSync(path.join(TMP, s.file));
  if (s.bytes && buf.length !== s.bytes) throw new Error(`${s.file}: ${buf.length} bytes, expected ${s.bytes}`);
  if (s.sha256 && sha256(buf) !== s.sha256) throw new Error(`${s.file}: checksum mismatch`);
  return [k, buf];
}));
const sourceInfo = Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, { ...s, sha256: sha256(files[k]) }]));

// --- 1. calibration
const { stars } = readHygHipparcos(files.hyg);
const hiptyc = readExr(files.hiptyc);
const { results, rejected } = measureStars({ stars, catalog: stars, planes: hiptyc.planes, width: hiptyc.width, height: hiptyc.height, magRange: CAL_RANGE });
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const offsets = results.map((p) => p.minst - p.mag);
const zp = median(offsets);
const madSigma = 1.4826 * median(offsets.map((o) => Math.abs(o - zp)));
const rms = Math.sqrt(offsets.reduce((s, o) => s + (o - zp) ** 2, 0) / offsets.length);
const freeFit = fitMagnitudes(results);
const centroid = { dx: median(results.map((p) => p.dx)), dy: median(results.map((p) => p.dy)) };
const byMag = [];
for (let m = Math.floor(CAL_RANGE[0]); m < CAL_RANGE[1]; m += 0.5) {
  const a = results.filter((p) => p.mag >= m && p.mag < m + 0.5).map((p) => p.minst - p.mag);
  if (a.length) byMag.push({ from: m, to: m + 0.5, n: a.length, medianOffset: +median(a).toFixed(3) });
}
const omegaEqArcsec2 = ((360 * 3600) / hiptyc.width) * ((180 * 3600) / hiptyc.height);
const K = 2.5 * Math.log10(omegaEqArcsec2) - zp; // mu = -2.5 log10(Y) + K
const muOf = (y) => -2.5 * Math.log10(y) + K;

// --- 2. background statistics
const mw = readExr(files.milkyway);
const { R, G, B } = mw.planes;
const W = mw.width; const H = mw.height;
const n = W * H;
const Y = new Float32Array(n);
let clipped = 0; const clippedPositions = []; let zeros = 0; let maxY = 0;
for (let i = 0; i < n; i++) {
  Y[i] = LUMA[0] * R[i] + LUMA[1] * G[i] + LUMA[2] * B[i];
  if (Y[i] > maxY) maxY = Y[i];
  if (Y[i] === 0) zeros++;
  if (R[i] >= 0.999 || G[i] >= 0.999 || B[i] >= 0.999) {
    clipped++;
    if (clippedPositions.length < 50) { const p = equirectRaDec((i % W) + 0.5, Math.floor(i / W) + 0.5, W, H); clippedPositions.push([+p.raDeg.toFixed(3), +p.decDeg.toFixed(3)]); }
  }
}
const sortedY = Float32Array.from(Y).sort();
const q = (p) => sortedY[Math.min(n - 1, Math.floor(p * n))];
const surface = { p1: +muOf(q(0.01)).toFixed(2), p50: +muOf(q(0.5)).toFixed(2), p99: +muOf(q(0.99)).toFixed(2), brightest: +muOf(maxY).toFixed(2) };

// --- 3. duplicate check: background peak at point-star positions vs random positions
function peakAt(raDeg, decDeg) {
  const p = equirectPixel(raDeg, decDeg, W, H);
  const cosd = Math.max(0.05, Math.cos((decDeg * Math.PI) / 180));
  let core = 0; const ring = [];
  for (let dy = -6; dy <= 6; dy++) for (let dx = -Math.ceil(6 / cosd); dx <= Math.ceil(6 / cosd); dx++) {
    const y = Math.floor(p.y) + dy; if (y < 0 || y >= H) continue;
    const x = (((Math.floor(p.x) + dx) % W) + W) % W;
    const d = Math.hypot((x + 0.5 - p.x) * cosd, y + 0.5 - p.y);
    const v = Y[y * W + x];
    if (d <= 1.5) core = Math.max(core, v); else if (d >= 3 && d <= 6) ring.push(v);
  }
  ring.sort((a, b) => a - b);
  const med = ring[ring.length >> 1];
  const mad = 1.4826 * ring.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[ring.length >> 1];
  return core - med > Math.max(10 * mad, 0.25 * med);
}
const pointStars = stars.filter((s) => s.mag <= STAR_LIMIT);
let starPeaks = 0; for (const s of pointStars) if (peakAt(s.raDeg, s.decDeg)) starPeaks++;
let randomPeaks = 0; for (const s of pointStars) if (peakAt((s.raDeg + 0.37) % 360, Math.max(-89, Math.min(89, s.decDeg - 0.29)))) randomPeaks++;
const duplicateCheck = { pointStars: pointStars.length, peaksAtStars: starPeaks, peaksAtShiftedPositions: randomPeaks, rule: 'peak = max within 1.5 px minus annulus (3-6 px) median > max(10 MAD, 25% of the median)' };

// --- 4. exposure
const yToCdm2 = 10.8e4 * 10 ** (-0.4 * K); // L (cd/m^2) = 10.8e4 * 10^(-0.4 mu)
const exposureStops = Math.floor(Math.log2((MIN_BLOOM_THRESHOLD * L_REF_CDM2) / (maxY * yToCdm2)));
const sceneScale = (yToCdm2 / L_REF_CDM2) * 2 ** exposureStops; // scene value per map unit

// --- 5. cube map
function sampleEquirect(raDeg, decDeg, out) {
  const p = equirectPixel(raDeg, decDeg, W, H);
  const fx = p.x - 0.5; const fy = Math.min(H - 1, Math.max(0, p.y - 0.5));
  const x0 = Math.floor(fx); const y0 = Math.floor(fy); const tx = fx - x0; const ty = fy - y0;
  const xa = ((x0 % W) + W) % W; const xb = (xa + 1) % W; const ya = y0; const yb = Math.min(H - 1, y0 + 1);
  for (const [k, plane] of [[0, R], [1, G], [2, B]]) {
    const v00 = plane[ya * W + xa]; const v10 = plane[ya * W + xb]; const v01 = plane[yb * W + xa]; const v11 = plane[yb * W + xb];
    out[k] += (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  }
}
// Level-0 faces are cached in tmp/sky (keyed by the source checksum) to make rebuilds fast.
const cachePath = path.join(TMP, `cube-faces-${CUBE_SIZE}-${sourceInfo.milkyway.sha256.slice(0, 10)}.f32`);
const faces = [];
if (fs.existsSync(cachePath)) {
  const all = new Float32Array(new Uint8Array(fs.readFileSync(cachePath)).buffer);
  for (let face = 0; face < 6; face++) faces.push(all.slice(face * CUBE_SIZE * CUBE_SIZE * 3, (face + 1) * CUBE_SIZE * CUBE_SIZE * 3));
} else for (let face = 0; face < 6; face++) {
  const data = new Float32Array(CUBE_SIZE * CUBE_SIZE * 3);
  const acc = [0, 0, 0];
  for (let y = 0; y < CUBE_SIZE; y++) for (let x = 0; x < CUBE_SIZE; x++) {
    acc[0] = acc[1] = acc[2] = 0;
    for (const oy of [0.25, 0.75]) for (const ox of [0.25, 0.75]) {
      const { raDeg, decDeg } = vectorToRaDec(normalize(cubeFaceDirection(face, (x + ox) / CUBE_SIZE, (y + oy) / CUBE_SIZE)));
      sampleEquirect(raDeg, decDeg, acc);
    }
    const o = (y * CUBE_SIZE + x) * 3;
    data[o] = acc[0] / 4; data[o + 1] = acc[1] / 4; data[o + 2] = acc[2] / 4;
  }
  faces.push(data);
}
if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, Buffer.concat(faces.map((f) => Buffer.from(f.buffer))));
function downsample(src, size) {
  const s = size >> 1; const out = new Float32Array(s * s * 3);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) for (let k = 0; k < 3; k++) {
    const a = ((2 * y) * size + 2 * x) * 3 + k;
    out[(y * s + x) * 3 + k] = (src[a] + src[a + 3] + src[a + size * 3] + src[a + size * 3 + 3]) / 4;
  }
  return out;
}
// Mip chain in linear space (box filter), level 0 first.
const linearLevels = [faces];
for (let sz = CUBE_SIZE; sz > 1; sz >>= 1) linearLevels.push(linearLevels.at(-1).map((f) => downsample(f, sz)));
const lumaOf = (f, i) => LUMA[0] * f[i * 3] + LUMA[1] * f[i * 3 + 1] + LUMA[2] * f[i * 3 + 2];
// Luminance: R8 log codes, all levels from CUBE_SIZE.
const lumLevels = linearLevels.map((level, L) => {
  const sz = CUBE_SIZE >> L;
  return { size: sz, faces: level.map((f) => { const out = new Uint8Array(sz * sz); for (let i = 0; i < sz * sz; i++) out[i] = encodeSkyValue(lumaOf(f, i)); return out; }) };
});
// Chromaticity: RG8 (R/(R+G+B), B/(R+G+B)), from CHROMA_SIZE down.
const chromaStart = Math.log2(CUBE_SIZE / CHROMA_SIZE);
const chromaLevels = linearLevels.slice(chromaStart).map((level, L) => {
  const sz = CHROMA_SIZE >> L;
  return { size: sz, faces: level.map((f) => { const out = new Uint8Array(sz * sz * 2); for (let i = 0; i < sz * sz; i++) { const [a, b] = encodeChromaticity(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]); out[i * 2] = a; out[i * 2 + 1] = b; } return out; }) };
});
const common = { 'LUMI.frame': 'ICRS/J2000 (cube lookup vector = ICRS vector)', 'LUMI.source': 'NASA SVS Deep Star Maps 2020, milkyway_2020_4k.exr' };
const outputs = {
  luminance: encodeKtx2Cube({ vkFormat: VK_FORMAT_R8_UNORM, levels: lumLevels, keyValues: { ...common, 'LUMI.encoding': `Rec.709 luminance, log2: code/255 * ${-LOG_MIN_STOPS} + ${LOG_MIN_STOPS}; code 0 = 0` } }),
  chroma: encodeKtx2Cube({ vkFormat: VK_FORMAT_R8G8_UNORM, levels: chromaLevels, keyValues: { ...common, 'LUMI.encoding': 'chromaticity R/(R+G+B), B/(R+G+B), linear 8-bit' } }),
};
fs.mkdirSync(ASSET_DIR, { recursive: true });
const written = {};
for (const [name, buf] of Object.entries(outputs)) {
  const h = sha256(buf);
  const prefix = name === 'luminance' ? 'milkyway-2020-luminance' : 'milkyway-2020-chroma';
  const fileName = `${prefix}-${h.slice(0, 10)}.ktx2`;
  for (const old of fs.readdirSync(ASSET_DIR)) if (new RegExp(`^${prefix}-[0-9a-f]{10}\\.ktx2$`).test(old) && old !== fileName) fs.unlinkSync(path.join(ASSET_DIR, old));
  for (const old of fs.readdirSync(ASSET_DIR)) if (/^milkyway-2020-cube-[0-9a-f]{10}\.ktx2$/.test(old)) fs.unlinkSync(path.join(ASSET_DIR, old));
  fs.writeFileSync(path.join(ASSET_DIR, fileName), buf);
  written[name] = { file: `assets/sky/${fileName}`, sha256: h, bytes: buf.length };
}
const totalBytes = written.luminance.bytes + written.chroma.bytes;
if (totalBytes > MAX_BYTES) throw new Error(`sky map assets ${totalBytes} B exceed the ${MAX_BYTES} B budget`);

const meta = {
  luminance: { ...written.luminance, format: 'KTX2 cube, VK_FORMAT_R8_UNORM + Zstd, 8-bit log2 codes of Rec.709 luminance', size: CUBE_SIZE, levels: lumLevels.length },
  chroma: { ...written.chroma, format: 'KTX2 cube, VK_FORMAT_R8G8_UNORM + Zstd, chromaticity R/(R+G+B), B/(R+G+B)', size: CHROMA_SIZE, levels: chromaLevels.length },
  totalBytes, budgetBytes: MAX_BYTES,
  encoding: { logMinStops: LOG_MIN_STOPS, quantisationErrorMag: +QUANTISATION_ERROR_MAG.toFixed(4) },
  calibration: {
    method: 'aperture photometry (r = 3 equatorial px, background annulus 5-7 px, Rec.709 luminance, flux weighted by cos dec) of isolated, non-saturated (no channel >= 0.98) HYG Hipparcos stars on hiptyc_2020_4k; |dec| <= 60',
    magRange: CAL_RANGE, stars: results.length, rejected, zeroPoint: +zp.toFixed(4), madSigmaMag: +madSigma.toFixed(3), rmsMag: +rms.toFixed(3),
    freeSlope: +freeFit.slope.toFixed(3), medianOffsetByMag: byMag, centroidOffsetPx: { dx: +centroid.dx.toFixed(3), dy: +centroid.dy.toFixed(3) },
  },
  surfaceBrightness: { K: +K.toFixed(4), unit: 'V mag/arcsec^2 (starlight of the background map only)', ...surface, equatorialPixelArcsec2: +omegaEqArcsec2.toFixed(1) },
  background: { width: W, height: H, maxValue: maxY, zeroPixels: zeros, clippedPixels: clipped, clippedPositionsRaDec: clippedPositions },
  duplicateCheck,
  exposure: { referenceCdm2: L_REF_CDM2, minBloomThreshold: MIN_BLOOM_THRESHOLD, stops: exposureStops, yToCdm2: +yToCdm2.toExponential(6), sceneScale: +sceneScale.toExponential(6),
    rule: 'largest integer N such that the brightest background texel stays below the lowest Earth bloom threshold' },
  sources: sourceInfo,
};
fs.writeFileSync(CONFIG_OUT, `// GENERATED by tools/build-sky-map.mjs - do not edit by hand.
// LOT 15: Milky Way background (NASA SVS Deep Star Maps 2020, milkyway_2020_4k) as a
// cube map, with the calibration and exposure constants derived from the data.
export const SKY_MAP_ASSET = Object.freeze(${JSON.stringify(meta)});
`);
console.log(JSON.stringify({ ...meta, background: { ...meta.background, clippedPositionsRaDec: clippedPositions.slice(0, 10) } }, null, 1));
