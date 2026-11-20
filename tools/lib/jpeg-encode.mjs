// LOT 30: minimal baseline JPEG encoder (JFIF, YCbCr 4:4:4, 8-bit, the standard Huffman tables of
// ITU-T T.81 Annex K, IJG quality scaling of the Annex K quantisation tables). Used by the offline
// asset tools only (tools/build-moon-*.mjs); no browser code imports it. Deterministic for a given
// input and quality on the same JavaScript engine (plain float arithmetic, fixed tables, no
// randomness, no timestamps in the file).
//   encodeJpeg({ width, height, data, channels = 3|4, quality = 90 }) -> Buffer

const ZIGZAG = Int32Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
  28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
  54, 47, 55, 62, 63,
]);
// Annex K.1 (natural order, row-major).
const Q_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const Q_CHROMA = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];
// Annex K.3: bits (counts per length 1..16) and values.
const DC_LUMA = { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const DC_CHROMA = { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const AC_LUMA = { bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], vals: [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] };
const AC_CHROMA = { bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], vals: [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] };

/** IJG quality scaling (jcparam.c). */
export function scaledQuantTable(base, quality) {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}

function huffmanCodes({ bits, vals }) {
  const codes = new Map();
  let code = 0; let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) codes.set(vals[k++], { code: code++, len });
    code <<= 1;
  }
  return codes;
}

// Orthonormal 8-point DCT-II basis: C[u][x] = c(u)/2 * cos((2x+1) u pi / 16), c(0) = 1/sqrt(2).
const BASIS = new Float64Array(64);
for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) BASIS[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);

class BitWriter {
  constructor() { this.chunks = []; this.buf = Buffer.alloc(1 << 20); this.pos = 0; this.acc = 0; this.n = 0; }
  byte(b) { if (this.pos === this.buf.length) { this.chunks.push(this.buf); this.buf = Buffer.alloc(1 << 20); this.pos = 0; } this.buf[this.pos++] = b; }
  write(code, len) {
    for (let i = len - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1); this.n++;
      if (this.n === 8) { this.byte(this.acc); if (this.acc === 0xff) this.byte(0); this.acc = 0; this.n = 0; }
    }
  }
  flush() { if (this.n > 0) this.write((1 << (8 - this.n)) - 1, 8 - this.n); }
  result() { this.chunks.push(this.buf.subarray(0, this.pos)); return Buffer.concat(this.chunks); }
}

const category = (v) => { let a = Math.abs(v); let n = 0; while (a) { n++; a >>= 1; } return n; };
const bitsOf = (v, n) => (v < 0 ? v + (1 << n) - 1 : v);

export function encodeJpeg({ width, height, data, channels = 3, quality = 90 }) {
  if (!(width > 0 && height > 0 && width < 65536 && height < 65536)) throw new Error('jpeg: bad size');
  if (data.length < width * height * channels) throw new Error('jpeg: data too short');
  const qt = [scaledQuantTable(Q_LUMA, quality), scaledQuantTable(Q_CHROMA, quality)];
  const huff = { dc: [huffmanCodes(DC_LUMA), huffmanCodes(DC_CHROMA)], ac: [huffmanCodes(AC_LUMA), huffmanCodes(AC_CHROMA)] };
  const out = new BitWriter();
  const head = [];
  const seg = (marker, body) => { head.push(Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff]), Buffer.from(body)); };
  head.push(Buffer.from([0xff, 0xd8]));
  seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]); // JFIF 1.01, aspect 1:1, no thumbnail
  for (let t = 0; t < 2; t++) seg(0xdb, [t, ...Array.from(ZIGZAG, (z) => qt[t][z])]);
  seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  for (const [cls, id, table] of [[0, 0, DC_LUMA], [1, 0, AC_LUMA], [0, 1, DC_CHROMA], [1, 1, AC_CHROMA]]) seg(0xc4, [(cls << 4) | id, ...table.bits, ...table.vals]);
  seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);

  const block = new Float64Array(64); const tmp = new Float64Array(64); const coef = new Int32Array(64);
  const pred = [0, 0, 0];
  const comp = new Float64Array(64 * 3);
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const sy = Math.min(height - 1, by + y);
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(width - 1, bx + x);
          const i = (sy * width + sx) * channels;
          const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
          // JFIF YCbCr (full range), centred on 0.
          comp[y * 8 + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
          comp[64 + y * 8 + x] = -0.168735892 * r - 0.331264108 * g + 0.5 * b;
          comp[128 + y * 8 + x] = 0.5 * r - 0.418687589 * g - 0.081312411 * b;
        }
      }
      for (let c = 0; c < 3; c++) {
        for (let k = 0; k < 64; k++) block[k] = comp[c * 64 + k];
        // Rows then columns.
        for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += BASIS[u * 8 + x] * block[y * 8 + x]; tmp[y * 8 + u] = s; }
        const q = qt[c === 0 ? 0 : 1];
        for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
          let s = 0; for (let y = 0; y < 8; y++) s += BASIS[v * 8 + y] * tmp[y * 8 + u];
          coef[v * 8 + u] = Math.round(s / q[v * 8 + u]);
        }
        const t = c === 0 ? 0 : 1;
        const dc = huff.dc[t]; const ac = huff.ac[t];
        const diff = coef[0] - pred[c]; pred[c] = coef[0];
        const dcat = category(diff); const dcode = dc.get(dcat);
        out.write(dcode.code, dcode.len); if (dcat) out.write(bitsOf(diff, dcat), dcat);
        let run = 0;
        for (let k = 1; k < 64; k++) {
          const v = coef[ZIGZAG[k]];
          if (v === 0) { run++; continue; }
          while (run > 15) { const zrl = ac.get(0xf0); out.write(zrl.code, zrl.len); run -= 16; }
          const cat = category(v); const code = ac.get((run << 4) | cat);
          out.write(code.code, code.len); out.write(bitsOf(v, cat), cat); run = 0;
        }
        if (run > 0) { const eob = ac.get(0x00); out.write(eob.code, eob.len); }
      }
    }
  }
  out.flush();
  return Buffer.concat([...head, out.result(), Buffer.from([0xff, 0xd9])]);
}
