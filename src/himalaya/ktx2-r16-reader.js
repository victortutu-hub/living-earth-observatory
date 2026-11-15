// Minimal KTX 2.0 reader for the Living Himalaya terrain patches:
// VK_FORMAT_R16_UNORM, one level, Zstandard supercompression, heights stored
// as q = round((h - offset) / scale) with offset/scale in the key/value data
// (LUMI.heightOffsetM, LUMI.heightScaleM). three.js KTX2Loader r185 does not
// read R16_UNORM, so this reader parses the container itself; the Zstd
// decoder is injected (browser: three/addons/libs/zstddec.module.js,
// tests: node:zlib), so no new dependency is involved.
// Written by tools/build-himalaya-patches.mjs via tools/lib/ktx2-r16f.mjs.

export const VK_FORMAT_R16_UNORM = 70;
const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const SUPERCOMPRESSION_ZSTD = 2;
const HEADER_BYTES = 80;

const align4 = (n) => (n + 3) & ~3;

function readKeyValues(bytes, offset, length) {
  const decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  for (let p = offset; p < offset + length;) {
    const size = view.getUint32(p, true);
    const body = bytes.subarray(p + 4, p + 4 + size);
    const split = body.indexOf(0);
    const key = decoder.decode(body.subarray(0, split));
    let value = body.subarray(split + 1);
    if (value.length && value[value.length - 1] === 0) value = value.subarray(0, value.length - 1);
    out[key] = decoder.decode(value);
    p += 4 + align4(size);
  }
  return out;
}

/**
 * @param {ArrayBuffer|Uint8Array} input
 * @param {{decode:(data:Uint8Array, size:number)=>Uint8Array}} zstd
 * @returns {{width:number,height:number,vkFormat:number,keyValues:object,data:Uint16Array}}
 */
export function readKtx2R16Unorm(input, zstd) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < HEADER_BYTES || IDENTIFIER.some((b, i) => bytes[i] !== b)) throw new Error('Not a KTX2 file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vkFormat = view.getUint32(12, true);
  if (vkFormat !== VK_FORMAT_R16_UNORM) throw new Error(`Unexpected vkFormat ${vkFormat} (R16_UNORM expected).`);
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  const levelCount = Math.max(1, view.getUint32(40, true));
  const supercompression = view.getUint32(44, true);
  const keyValues = readKeyValues(bytes, view.getUint32(56, true), view.getUint32(60, true));
  const offset = Number(view.getBigUint64(HEADER_BYTES, true));
  const length = Number(view.getBigUint64(HEADER_BYTES + 8, true));
  const rawLength = Number(view.getBigUint64(HEADER_BYTES + 16, true));
  if (levelCount < 1 || rawLength !== width * height * 2) throw new Error('Level 0 size does not match the header.');
  const level = bytes.subarray(offset, offset + length);
  let raw;
  if (supercompression === SUPERCOMPRESSION_ZSTD) {
    if (!zstd?.decode) throw new Error('A Zstd decoder is required.');
    raw = zstd.decode(level, rawLength);
  } else if (supercompression === 0) {
    raw = level;
  } else {
    throw new Error(`Unsupported supercompression ${supercompression}.`);
  }
  const data = new Uint16Array(width * height);
  new Uint8Array(data.buffer).set(raw.subarray ? raw.subarray(0, rawLength) : raw);
  return { width, height, vkFormat, keyValues, data };
}

/** Heights in metres from the quantized values and the declared offset/scale. */
export function dequantizeHeights(data, offsetM, scaleM) {
  if (!Number.isFinite(offsetM) || !(scaleM > 0)) throw new Error('Invalid height offset/scale.');
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = offsetM + data[i] * scaleM;
  return out;
}
