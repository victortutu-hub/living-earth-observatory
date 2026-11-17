// Minimal OpenEXR reader for the NASA SVS Deep Star Maps 2020 files used by
// LOT 15: single-part scanline images, HALF or FLOAT channels, compression
// NONE / ZIPS / ZIP (zlib + OpenEXR byte interleave + delta predictor). Any
// other compression (PIZ, PXR24, B44, DWA...) is rejected, never guessed.
// No dependency beyond node:zlib.
import zlib from 'node:zlib';

const COMPRESSION = ['NONE', 'RLE', 'ZIPS', 'ZIP', 'PIZ', 'PXR24', 'B44', 'B44A', 'DWAA', 'DWAB'];
const LINES_PER_BLOCK = { NONE: 1, ZIPS: 1, ZIP: 16 };
const PIXEL_TYPES = ['UINT', 'HALF', 'FLOAT'];
const BYTES = { UINT: 4, HALF: 2, FLOAT: 4 };

export function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** Parses the header; returns { attributes, channels, compression, width, height, headerEnd }. */
export function readExrHeader(buffer) {
  if (buffer.readUInt32LE(0) !== 20000630) throw new Error('Not an OpenEXR file.');
  const version = buffer.readUInt32LE(4);
  if ((version & 0xff) !== 2) throw new Error(`Unsupported OpenEXR version ${version & 0xff}.`);
  if (version & 0x200) throw new Error('Tiled OpenEXR is not supported.');
  if (version & 0x1000) throw new Error('Multi-part OpenEXR is not supported.');
  let o = 8;
  const cstr = () => { const end = buffer.indexOf(0, o); const s = buffer.toString('latin1', o, end); o = end + 1; return s; };
  const attributes = {};
  let channels = null; let compression = null; let dataWindow = null;
  for (;;) {
    const name = cstr();
    if (!name) break;
    const type = cstr();
    const size = buffer.readInt32LE(o); o += 4;
    const value = buffer.subarray(o, o + size); o += size;
    if (type === 'chlist') {
      channels = [];
      let p = 0;
      while (value[p]) {
        const end = value.indexOf(0, p);
        const channel = value.toString('latin1', p, end); p = end + 1;
        const pixelType = PIXEL_TYPES[value.readInt32LE(p)]; p += 16; // type, pLinear+reserved, xSampling, ySampling
        channels.push({ name: channel, type: pixelType });
      }
      attributes[name] = channels.map((c) => `${c.name}:${c.type}`).join(' ');
    } else if (type === 'compression') {
      compression = COMPRESSION[value[0]];
      attributes[name] = compression;
    } else if (type === 'box2i') {
      const box = [0, 4, 8, 12].map((i) => value.readInt32LE(i));
      attributes[name] = box;
      if (name === 'dataWindow') dataWindow = box;
    } else attributes[name] = type;
  }
  if (!channels || !compression || !dataWindow) throw new Error('Incomplete OpenEXR header.');
  if (!(compression in LINES_PER_BLOCK)) throw new Error(`Unsupported OpenEXR compression: ${compression} (only NONE / ZIPS / ZIP).`);
  return { attributes, channels, compression, width: dataWindow[2] - dataWindow[0] + 1, height: dataWindow[3] - dataWindow[1] + 1, yMin: dataWindow[1], headerEnd: o };
}

function unzipBlock(data, expected) {
  const raw = zlib.inflateSync(data);
  if (raw.length !== expected) throw new Error(`OpenEXR ZIP block: ${raw.length} bytes, expected ${expected}.`);
  // Delta predictor, then de-interleave (first half: even bytes, second half: odd bytes).
  for (let i = 1; i < raw.length; i++) raw[i] = (raw[i - 1] + raw[i] - 128) & 0xff;
  const out = Buffer.allocUnsafe(raw.length);
  const half = (raw.length + 1) >> 1;
  for (let i = 0, j = 0; i < raw.length; i += 2, j++) {
    out[i] = raw[j];
    if (i + 1 < raw.length) out[i + 1] = raw[half + j];
  }
  return out;
}

/**
 * Decodes the image into Float32Array planes { R, G, B, ... } (row 0 = top),
 * values linear as stored.
 */
export function readExr(buffer) {
  const header = readExrHeader(buffer);
  const { channels, compression, width, height, yMin } = header;
  const lines = LINES_PER_BLOCK[compression];
  const blocks = Math.ceil(height / lines);
  const lineBytes = channels.reduce((sum, c) => sum + BYTES[c.type] * width, 0);
  const planes = Object.fromEntries(channels.map((c) => [c.name, new Float32Array(width * height)]));
  let o = header.headerEnd;
  const offsets = [];
  for (let b = 0; b < blocks; b++) { offsets.push(Number(buffer.readBigUInt64LE(o))); o += 8; }
  for (const offset of offsets) {
    const y0 = buffer.readInt32LE(offset) - yMin;
    const size = buffer.readInt32LE(offset + 4);
    const n = Math.min(lines, height - y0);
    const packed = buffer.subarray(offset + 8, offset + 8 + size);
    const expected = lineBytes * n;
    const data = compression === 'NONE' || size === expected ? Buffer.from(packed) : unzipBlock(packed, expected);
    let p = 0;
    for (let line = 0; line < n; line++) {
      const row = (y0 + line) * width;
      for (const channel of channels) {
        const plane = planes[channel.name];
        if (channel.type === 'HALF') for (let x = 0; x < width; x++, p += 2) plane[row + x] = halfToFloat(data.readUInt16LE(p));
        else if (channel.type === 'FLOAT') for (let x = 0; x < width; x++, p += 4) plane[row + x] = data.readFloatLE(p);
        else for (let x = 0; x < width; x++, p += 4) plane[row + x] = data.readUInt32LE(p);
      }
    }
  }
  return { ...header, planes };
}
