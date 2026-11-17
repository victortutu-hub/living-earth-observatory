// LOT 15: reader for the sky cube maps written by tools/lib/ktx2-cube.mjs
// (KTX 2.0, faceCount 6, uncompressed 8-bit UNORM R8 / R8G8 / R8G8B8A8, Zstd).
// Pure: the Zstd decoder is injected ({ decode(Uint8Array, expectedSize) -> Uint8Array },
// e.g. three's zstddec in the browser, node:zlib in tests). Own reader rather than
// KTX2Loader: the sky needs explicit control of the 6 faces and of every mip level.
const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
export const SKY_KTX2_FORMATS = Object.freeze({ 9: { name: 'R8', channels: 1 }, 16: { name: 'RG8', channels: 2 }, 37: { name: 'RGBA8', channels: 4 } });

export function readSkyCubeKtx2(arrayBuffer, zstd) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  for (let i = 0; i < 12; i++) if (bytes[i] !== IDENTIFIER[i]) throw new Error('Not a KTX2 file.');
  const vkFormat = view.getUint32(12, true);
  const format = SKY_KTX2_FORMATS[vkFormat];
  if (!format) throw new Error(`Unsupported sky KTX2 format ${vkFormat}.`);
  const size = view.getUint32(20, true);
  if (view.getUint32(24, true) !== size) throw new Error('Sky cube faces must be square.');
  if (view.getUint32(36, true) !== 6) throw new Error('Sky KTX2 must be a cube map (faceCount 6).');
  const levelCount = view.getUint32(40, true);
  const supercompression = view.getUint32(44, true);
  if (supercompression !== 0 && supercompression !== 2) throw new Error(`Unsupported KTX2 supercompression ${supercompression}.`);
  const levels = [];
  for (let L = 0; L < levelCount; L++) {
    const at = 80 + 24 * L;
    const offset = Number(view.getBigUint64(at, true));
    const length = Number(view.getBigUint64(at + 8, true));
    const rawLength = Number(view.getBigUint64(at + 16, true));
    const levelSize = Math.max(1, size >> L);
    const faceBytes = levelSize * levelSize * format.channels;
    if (rawLength !== faceBytes * 6) throw new Error(`Sky KTX2 level ${L}: ${rawLength} bytes, expected ${faceBytes * 6}.`);
    const packed = bytes.subarray(offset, offset + length);
    const raw = supercompression === 2 ? zstd.decode(packed, rawLength) : packed;
    if (raw.length !== rawLength) throw new Error(`Sky KTX2 level ${L}: decoded ${raw.length} bytes, expected ${rawLength}.`);
    levels.push({ size: levelSize, faces: [0, 1, 2, 3, 4, 5].map((f) => raw.slice(f * faceBytes, (f + 1) * faceBytes)) });
  }
  return { vkFormat, format: format.name, channels: format.channels, size, levels };
}
