// Minimal KTX 2.0 writer/reader for one format only: VK_FORMAT_R16_SFLOAT
// (single-channel half float, linear data) with Zstandard supercompression and
// precomputed mip levels. Enough for three.js KTX2Loader (r185), which reads
// uncompressed R16_SFLOAT natively (DataTexture, HalfFloatType) and decodes
// Zstd itself; no Basis transcoder and no toktx are involved.
// Spec: https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html
import zlib from 'node:zlib';

export const VK_FORMAT_R16_SFLOAT = 76;
const KTX2_IDENTIFIER = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
const SUPERCOMPRESSION_ZSTD = 2;
const HEADER_BYTES = 80;
const LEVEL_INDEX_BYTES = 24;

const align4 = (n) => (n + 3) & ~3;

// Basic Data Format Descriptor for R16_SFLOAT: RGBSDA model, BT.709 primaries,
// LINEAR transfer, one 16-bit signed float sample on the red channel.
function dataFormatDescriptor() {
    const dfd = Buffer.alloc(44);
    dfd.writeUInt32LE(44, 0); // dfdTotalSize
    dfd.writeUInt32LE(0, 4); // vendorId 0 (Khronos), descriptorType 0 (basic)
    dfd.writeUInt16LE(2, 8); // versionNumber
    dfd.writeUInt16LE(40, 10); // descriptorBlockSize = 24 + 16 * samples
    dfd[12] = 1; // colorModel KHR_DF_MODEL_RGBSDA
    dfd[13] = 1; // colorPrimaries BT709
    dfd[14] = 1; // transferFunction LINEAR
    dfd[15] = 0; // flags: straight alpha
    // texelBlockDimension0..3 = 0 (1x1x1x1), bytes 16..19
    dfd[20] = 2; // bytesPlane0
    // sample 0
    dfd.writeUInt16LE(0, 28); // bitOffset
    dfd[30] = 15; // bitLength - 1
    dfd[31] = 0x80 | 0x40 | 0; // FLOAT | SIGNED | channel RED
    // samplePosition0..3 = 0, bytes 32..35
    dfd.writeUInt32LE(0xbf800000, 36); // sampleLower = -1.0f
    dfd.writeUInt32LE(0x3f800000, 40); // sampleUpper = +1.0f
    return dfd;
}

function keyValueData(keyValues) {
    const parts = Object.keys(keyValues).sort().map((key) => {
        const body = Buffer.concat([Buffer.from(key, 'utf8'), Buffer.from([0]), Buffer.from(String(keyValues[key]), 'utf8'), Buffer.from([0])]);
        const entry = Buffer.alloc(4 + align4(body.length));
        entry.writeUInt32LE(body.length, 0);
        body.copy(entry, 4);
        return entry;
    });
    return Buffer.concat(parts);
}

/**
 * levels: [{ width, height, data: Uint16Array (half-float bit patterns) }],
 * level 0 first, rows in the order the texture should be uploaded.
 */
export function encodeKtx2R16F({ levels, keyValues = {}, zstdLevel = 19 }) {
    if (!levels?.length) throw new Error('at least one level is required');
    const { width, height } = levels[0];
    levels.forEach((level, i) => {
        const w = Math.max(1, width >> i);
        const h = Math.max(1, height >> i);
        if (level.width !== w || level.height !== h || level.data.length !== w * h) {
            throw new Error(`level ${i} must be ${w}x${h}`);
        }
    });
    const compressed = levels.map((level) => {
        const raw = Buffer.from(level.data.buffer, level.data.byteOffset, level.data.byteLength);
        return {
            raw,
            data: zlib.zstdCompressSync(raw, { params: { [zlib.constants.ZSTD_c_compressionLevel]: zstdLevel } }),
        };
    });
    const dfd = dataFormatDescriptor();
    const kvd = keyValueData({ KTXwriter: 'Luminomorphism tools/build-relief.mjs (R16_SFLOAT + Zstd)', ...keyValues });
    const dfdOffset = HEADER_BYTES + LEVEL_INDEX_BYTES * levels.length;
    const kvdOffset = dfdOffset + dfd.length;
    let dataOffset = align4(kvdOffset + kvd.length);
    // Level data is stored smallest level first (KTX2 spec); the index lists level 0 first.
    const offsets = new Array(levels.length);
    for (let i = levels.length - 1; i >= 0; i--) {
        offsets[i] = dataOffset;
        dataOffset += compressed[i].data.length;
    }
    const out = Buffer.alloc(dataOffset);
    KTX2_IDENTIFIER.copy(out, 0);
    out.writeUInt32LE(VK_FORMAT_R16_SFLOAT, 12);
    out.writeUInt32LE(2, 16); // typeSize
    out.writeUInt32LE(width, 20);
    out.writeUInt32LE(height, 24);
    out.writeUInt32LE(0, 28); // pixelDepth
    out.writeUInt32LE(0, 32); // layerCount
    out.writeUInt32LE(1, 36); // faceCount
    out.writeUInt32LE(levels.length, 40);
    out.writeUInt32LE(SUPERCOMPRESSION_ZSTD, 44);
    out.writeUInt32LE(dfdOffset, 48);
    out.writeUInt32LE(dfd.length, 52);
    out.writeUInt32LE(kvdOffset, 56);
    out.writeUInt32LE(kvd.length, 60);
    out.writeBigUInt64LE(0n, 64); // sgdByteOffset
    out.writeBigUInt64LE(0n, 72); // sgdByteLength
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

/** Reads back what encodeKtx2R16F writes (used by tests and the build report). */
export function decodeKtx2R16F(buffer) {
    if (!buffer.subarray(0, 12).equals(KTX2_IDENTIFIER)) throw new Error('not a KTX2 file');
    const vkFormat = buffer.readUInt32LE(12);
    const width = buffer.readUInt32LE(20);
    const height = buffer.readUInt32LE(24);
    const levelCount = buffer.readUInt32LE(40);
    const supercompression = buffer.readUInt32LE(44);
    const kvdOffset = buffer.readUInt32LE(56);
    const kvdLength = buffer.readUInt32LE(60);
    const keyValues = {};
    for (let p = kvdOffset; p < kvdOffset + kvdLength;) {
        const length = buffer.readUInt32LE(p);
        const body = buffer.subarray(p + 4, p + 4 + length);
        const split = body.indexOf(0);
        keyValues[body.subarray(0, split).toString('utf8')] = body.subarray(split + 1).toString('utf8').replace(/\0$/, '');
        p += 4 + align4(length);
    }
    const levels = [];
    for (let i = 0; i < levelCount; i++) {
        const at = HEADER_BYTES + LEVEL_INDEX_BYTES * i;
        const offset = Number(buffer.readBigUInt64LE(at));
        const length = Number(buffer.readBigUInt64LE(at + 8));
        const raw = supercompression === SUPERCOMPRESSION_ZSTD
            ? zlib.zstdDecompressSync(buffer.subarray(offset, offset + length))
            : buffer.subarray(offset, offset + length);
        const copy = new Uint16Array(raw.length / 2);
        Buffer.from(copy.buffer).set(raw);
        levels.push({ width: Math.max(1, width >> i), height: Math.max(1, height >> i), data: copy });
    }
    return { vkFormat, width, height, supercompression, keyValues, levels };
}

/** Box-filtered mip chain from float data (row-major), down to 1x1. */
export function buildMipChain(data, width, height) {
    const chain = [{ width, height, data }];
    while (chain.at(-1).width > 1 || chain.at(-1).height > 1) {
        const src = chain.at(-1);
        const w = Math.max(1, src.width >> 1);
        const h = Math.max(1, src.height >> 1);
        const out = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0; let n = 0;
                for (let dy = 0; dy < 2; dy++) {
                    for (let dx = 0; dx < 2; dx++) {
                        const sx = Math.min(src.width - 1, x * 2 + dx);
                        const sy = Math.min(src.height - 1, y * 2 + dy);
                        sum += src.data[sy * src.width + sx]; n++;
                    }
                }
                out[y * w + x] = sum / n;
            }
        }
        chain.push({ width: w, height: h, data: out });
    }
    return chain;
}

// IEEE 754 half-float codec written out explicitly: Float16Array exists only
// from Node 24, while CI and the server run Node 22.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** One float -> half-float bits, round to nearest even (overflow -> Inf, NaN kept). */
export function floatToHalfBits(value) {
    f32[0] = value;
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const exponent = (x >>> 23) & 0xff;
    let mantissa = x & 0x7fffff;
    if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0); // Inf / NaN
    let e = exponent - 127 + 15;
    if (e >= 0x1f) return sign | 0x7c00; // overflow -> Inf
    if (e <= 0) {
        // Subnormal half (or zero): shift the implicit 1 in, then round.
        if (e < -10) return sign;
        mantissa |= 0x800000;
        const shift = 14 - e;
        let half = mantissa >>> shift;
        const rest = mantissa & ((1 << shift) - 1);
        const halfway = 1 << (shift - 1);
        if (rest > halfway || (rest === halfway && (half & 1))) half += 1;
        return sign | half;
    }
    let half = (e << 10) | (mantissa >>> 13);
    const rest = mantissa & 0x1fff;
    if (rest > 0x1000 || (rest === 0x1000 && (half & 1))) half += 1; // may carry into the exponent (correct)
    return sign | half;
}

/** Half-float bits -> number. */
export function halfBitsToFloat(bits) {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >>> 10) & 0x1f;
    const mantissa = bits & 0x3ff;
    if (exponent === 0) return sign * mantissa * 2 ** -24;
    if (exponent === 0x1f) return mantissa ? NaN : sign * Infinity;
    return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/** Float32 -> IEEE half-float bit patterns (round to nearest even). */
export function toHalfBits(floats) {
    const out = new Uint16Array(floats.length);
    for (let i = 0; i < floats.length; i++) out[i] = floatToHalfBits(floats[i]);
    return out;
}

/** Half-float bit patterns -> Float32Array. */
export function fromHalfBits(bits) {
    const out = new Float32Array(bits.length);
    for (let i = 0; i < bits.length; i++) out[i] = halfBitsToFloat(bits[i]);
    return out;
}
