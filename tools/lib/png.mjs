// Dependency-free PNG helpers for the visual-lock harness: decode (8-bit
// RGB/RGBA, non-interlaced, as produced by Chrome screenshots), encode RGBA,
// crop and pixel diff.
import zlib from 'node:zlib';

export function decodePng(buffer) {
  let offset = 8;
  let width = 0; let height = 0; let colorType = 0; let bitDepth = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) throw new Error(`unsupported PNG ${bitDepth}/${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) out[(y * width + x) * 4 + k] = line[x * channels + k];
      out[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    previous = line;
  }
  return { width, height, data: out };
}

// 8-bit palette PNG (colour type 3) -> palette indices, plus palette and
// tRNS alpha (used for the GIBS MODIS_Water_Mask tiles).
export function decodePngIndexed(buffer) {
  let offset = 8;
  let width = 0; let height = 0; let colorType = 0; let bitDepth = 0;
  const idat = [];
  let palette = null; let alpha = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') alpha = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || colorType !== 3) throw new Error(`not an 8-bit palette PNG (${bitDepth}/${colorType})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const indices = new Uint8Array(width * height);
  let previous = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)];
    const line = new Uint8Array(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)));
    for (let x = 0; x < width; x++) {
      const a = x >= 1 ? line[x - 1] : 0; const b = previous[x]; const c = x >= 1 ? previous[x - 1] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = value & 0xff;
    }
    indices.set(line, y * width);
    previous = line;
  }
  return { width, height, indices, palette, alpha };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 8-bit grayscale PNG with tEXt metadata ({ keyword: text }), Up-filtered rows. */
export function encodePngGray8({ width, height, data, text = {} }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 0; header[10] = 0; header[11] = 0; header[12] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 2; // Up filter
    for (let x = 0; x < width; x++) {
      const above = y > 0 ? data[(y - 1) * width + x] : 0;
      raw[y * (width + 1) + 1 + x] = (data[y * width + x] - above) & 0xff;
    }
  }
  const textChunks = Object.entries(text).map(([keyword, value]) => chunk('tEXt', Buffer.from(`${keyword}\0${value}`, 'latin1')));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    ...textChunks,
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function cropImage(image, { x, y, width, height }) {
  const left = Math.max(0, Math.min(image.width - width, Math.round(x)));
  const top = Math.max(0, Math.min(image.height - height, Math.round(y)));
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    image.data.copy(data, row * width * 4, ((top + row) * image.width + left) * 4, ((top + row) * image.width + left + width) * 4);
  }
  return { width, height, data, left, top };
}

export function diffImages(a, b, threshold = 8) {
  if (a.width !== b.width || a.height !== b.height) return { sameSize: false };
  let sum = 0; let changed = 0; let max = 0;
  const pixels = a.width * a.height;
  for (let i = 0; i < pixels; i++) {
    let pixelMax = 0;
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(a.data[i * 4 + k] - b.data[i * 4 + k]);
      sum += d; if (d > pixelMax) pixelMax = d;
    }
    if (pixelMax > threshold) changed += 1;
    if (pixelMax > max) max = pixelMax;
  }
  return { sameSize: true, meanAbsDiff: +(sum / (pixels * 3)).toFixed(3), changedPct: +(100 * changed / pixels).toFixed(3), maxDiff: max };
}

export function luminance(image, x, y) {
  const i = (Math.round(y) * image.width + Math.round(x)) * 4;
  return 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
}
