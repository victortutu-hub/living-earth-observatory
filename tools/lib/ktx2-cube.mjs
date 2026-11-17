// LOT 15: KTX 2.0 writer for cube maps (faceCount 6) with Zstandard
// supercompression, uncompressed 8-bit UNORM formats (R8, R8G8, R8G8B8A8) and
// half-float RGBA. The sky uses R8 (log-encoded luminance) and R8G8
// (chromaticity); decoding: src/core/sky/sky-encoding.js. Reader:
// src/core/sky/sky-ktx2.js.
// Each mip level stores the 6 faces one after another (+X, -X, +Y, -Y, +Z, -Z).
// Extends tools/lib/ktx2-r16f.mjs (same container, key/value data and Zstd).
import zlib from 'node:zlib';
import { KTX2_IDENTIFIER, keyValueData } from './ktx2-r16f.mjs';

export const VK_FORMAT_R8_UNORM = 9;
export const VK_FORMAT_R8G8_UNORM = 16;
export const VK_FORMAT_R8G8B8A8_UNORM = 37;
export const VK_FORMAT_R16G16B16A16_SFLOAT = 97;
const SUPERCOMPRESSION_ZSTD = 2;
const HEADER_BYTES = 80;
const LEVEL_INDEX_BYTES = 24;
const align4 = (n) => (n + 3) & ~3;

const FORMATS = {
  [VK_FORMAT_R8_UNORM]: { typeSize: 1, bytes: 1, bits: 8, float: false, channels: [0] },
  [VK_FORMAT_R8G8_UNORM]: { typeSize: 1, bytes: 2, bits: 8, float: false, channels: [0, 1] },
  [VK_FORMAT_R8G8B8A8_UNORM]: { typeSize: 1, bytes: 4, bits: 8, float: false, channels: [0, 1, 2, 15] },
  [VK_FORMAT_R16G16B16A16_SFLOAT]: { typeSize: 2, bytes: 8, bits: 16, float: true, channels: [0, 1, 2, 15] },
};

// Basic DFD, RGBSDA model, BT.709 primaries, LINEAR transfer, one sample per channel.
function dataFormatDescriptor(vkFormat) {
  const f = FORMATS[vkFormat];
  const samples = f.channels.length;
  const blockSize = 24 + 16 * samples;
  const dfd = Buffer.alloc(4 + blockSize);
  dfd.writeUInt32LE(4 + blockSize, 0);
  dfd.writeUInt32LE(0, 4);
  dfd.writeUInt16LE(2, 8);
  dfd.writeUInt16LE(blockSize, 10);
  dfd[12] = 1; dfd[13] = 1; dfd[14] = 1; dfd[15] = 0;
  dfd[20] = f.bytes; // bytesPlane0
  f.channels.forEach((channel, i) => {
    const at = 28 + 16 * i;
    dfd.writeUInt16LE(i * f.bits, at);
    dfd[at + 2] = f.bits - 1;
    dfd[at + 3] = (f.float ? 0xc0 : 0) | channel;
    if (f.float) { dfd.writeUInt32LE(0xbf800000, at + 8); dfd.writeUInt32LE(0x3f800000, at + 12); } else { dfd.writeUInt32LE(0, at + 8); dfd.writeUInt32LE(255, at + 12); }
  });
  return dfd;
}

/**
 * levels: [{ size, faces: [6 x (Uint8Array | Uint16Array)] }], level 0 first.
 * Face data: rows top to bottom as uploaded (GL cube map convention).
 */
export function encodeKtx2Cube({ vkFormat, levels, keyValues = {}, zstdLevel = 19, writer = 'Luminomorphism tools/build-sky-map.mjs' }) {
  const f = FORMATS[vkFormat];
  if (!f) throw new Error(`unsupported vkFormat ${vkFormat}`);
  const size0 = levels[0].size;
  levels.forEach((level, i) => {
    const s = Math.max(1, size0 >> i);
    if (level.size !== s || level.faces.length !== 6) throw new Error(`level ${i} must be 6 faces of ${s}x${s}`);
    for (const face of level.faces) if (face.byteLength !== s * s * f.bytes) throw new Error(`level ${i}: wrong face size`);
  });
  const compressed = levels.map((level) => {
    const raw = Buffer.concat(level.faces.map((face) => Buffer.from(face.buffer, face.byteOffset, face.byteLength)));
    return { raw, data: zlib.zstdCompressSync(raw, { params: { [zlib.constants.ZSTD_c_compressionLevel]: zstdLevel } }) };
  });
  const dfd = dataFormatDescriptor(vkFormat);
  const kvd = keyValueData({ KTXwriter: writer, ...keyValues });
  const dfdOffset = HEADER_BYTES + LEVEL_INDEX_BYTES * levels.length;
  const kvdOffset = dfdOffset + dfd.length;
  let dataOffset = align4(kvdOffset + kvd.length);
  const offsets = new Array(levels.length);
  for (let i = levels.length - 1; i >= 0; i--) { offsets[i] = dataOffset; dataOffset += compressed[i].data.length; }
  const out = Buffer.alloc(dataOffset);
  KTX2_IDENTIFIER.copy(out, 0);
  out.writeUInt32LE(vkFormat, 12);
  out.writeUInt32LE(f.typeSize, 16);
  out.writeUInt32LE(size0, 20);
  out.writeUInt32LE(size0, 24);
  out.writeUInt32LE(0, 28);
  out.writeUInt32LE(0, 32);
  out.writeUInt32LE(6, 36); // faceCount
  out.writeUInt32LE(levels.length, 40);
  out.writeUInt32LE(SUPERCOMPRESSION_ZSTD, 44);
  out.writeUInt32LE(dfdOffset, 48);
  out.writeUInt32LE(dfd.length, 52);
  out.writeUInt32LE(kvdOffset, 56);
  out.writeUInt32LE(kvd.length, 60);
  out.writeBigUInt64LE(0n, 64);
  out.writeBigUInt64LE(0n, 72);
  levels.forEach((_, i) => {
    const at = HEADER_BYTES + LEVEL_INDEX_BYTES * i;
    out.writeBigUInt64LE(BigInt(offsets[i]), at);
    out.writeBigUInt64LE(BigInt(compressed[i].data.length), at + 8);
    out.writeBigUInt64LE(BigInt(compressed[i].raw.length), at + 16);
  });
  dfd.copy(out, dfdOffset);
  kvd.copy(out, kvdOffset);
  compressed.forEach((level, i) => level.data.copy(out, offsets[i]));
  return out;
}
