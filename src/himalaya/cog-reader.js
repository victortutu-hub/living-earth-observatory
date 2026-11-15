// Living Himalaya LOT 4: minimal Cloud-Optimized GeoTIFF reader for the
// Sentinel-2 L2A COGs on AWS (classic little-endian TIFF, tiled, DEFLATE
// with the zlib wrapper, horizontal predictor 2, 8- or 16-bit, one or more
// interleaved samples). No library: the inflate step is injected (browser:
// DecompressionStream('deflate'); tests: node:zlib).
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 7: 1, 8: 2, 9: 4, 11: 4, 12: 8, 16: 8 };

export class HeaderTooShortError extends Error {}

/** Parses every IFD (full resolution first, then overviews) from the header bytes. */
export function parseCogHeader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x49 || bytes[1] !== 0x49 || view.getUint16(2, true) !== 42) throw new Error('Only little-endian classic TIFF is supported.');
  const ifds = [];
  let offset = view.getUint32(4, true);
  while (offset) {
    if (offset + 2 > bytes.length) throw new HeaderTooShortError('IFD outside the header bytes');
    const count = view.getUint16(offset, true);
    if (offset + 2 + count * 12 + 4 > bytes.length) throw new HeaderTooShortError('IFD entries outside the header bytes');
    const tags = {};
    for (let i = 0; i < count; i++) {
      const at = offset + 2 + i * 12;
      const tag = view.getUint16(at, true);
      const type = view.getUint16(at + 2, true);
      const n = view.getUint32(at + 4, true);
      const size = (TYPE_SIZE[type] || 1) * n;
      const p = size <= 4 ? at + 8 : view.getUint32(at + 8, true);
      if (p + size > bytes.length) throw new HeaderTooShortError(`tag ${tag} outside the header bytes`);
      const values = new Array(n);
      for (let k = 0; k < n; k++) {
        const q = p + k * (TYPE_SIZE[type] || 1);
        values[k] = type === 3 ? view.getUint16(q, true) : type === 4 ? view.getUint32(q, true) : type === 12 ? view.getFloat64(q, true) : type === 16 ? Number(view.getBigUint64(q, true)) : bytes[q];
      }
      tags[tag] = values;
    }
    const one = (t, d = undefined) => (tags[t] ? tags[t][0] : d);
    ifds.push({
      width: one(256), height: one(257), bitsPerSample: one(258, 8), samplesPerPixel: one(277, 1),
      compression: one(259, 1), predictor: one(317, 1), tileWidth: one(322), tileHeight: one(323),
      offsets: tags[324], counts: tags[325],
      pixelScale: tags[33550] ? tags[33550].slice(0, 2) : null,
      tiepoint: tags[33922] ? [tags[33922][3], tags[33922][4]] : null,
      nodata: tags[42113] ? String.fromCharCode(...tags[42113]).replace(/\0/g, '') : null,
    });
    const next = offset + 2 + count * 12;
    if (next + 4 > bytes.length) throw new HeaderTooShortError('next-IFD pointer outside the header bytes');
    offset = view.getUint32(next, true);
  }
  // Geo-referencing of the overviews from the full-resolution IFD.
  const base = ifds[0];
  if (base?.pixelScale && base.tiepoint) {
    ifds.forEach((ifd) => {
      const factor = base.width / ifd.width;
      ifd.resolution = base.pixelScale[0] * factor;
      ifd.origin = { e: base.tiepoint[0], n: base.tiepoint[1] };
    });
  }
  return ifds;
}

/** Tiles of `ifd` intersecting the pixel window, merged into byte ranges (gap tolerance in bytes). */
export function tileRanges(ifd, { c0, c1, r0, r1 }, gap = 256 * 1024) {
  const across = Math.ceil(ifd.width / ifd.tileWidth);
  const down = Math.ceil(ifd.height / ifd.tileHeight);
  const tiles = [];
  for (let ty = Math.max(0, Math.floor(r0 / ifd.tileHeight)); ty <= Math.min(down - 1, Math.floor(r1 / ifd.tileHeight)); ty++) {
    for (let tx = Math.max(0, Math.floor(c0 / ifd.tileWidth)); tx <= Math.min(across - 1, Math.floor(c1 / ifd.tileWidth)); tx++) {
      const index = ty * across + tx;
      if (ifd.counts[index] > 0) tiles.push({ index, tx, ty, offset: ifd.offsets[index], count: ifd.counts[index] });
    }
  }
  tiles.sort((a, b) => a.offset - b.offset);
  const ranges = [];
  for (const tile of tiles) {
    const last = ranges[ranges.length - 1];
    if (last && tile.offset - (last.end + 1) <= gap) { last.end = Math.max(last.end, tile.offset + tile.count - 1); last.tiles.push(tile); }
    else ranges.push({ start: tile.offset, end: tile.offset + tile.count - 1, tiles: [tile] });
  }
  return ranges;
}

/** Undoes predictor 2 on inflated tile bytes; returns Uint8Array or Uint16Array (interleaved samples). */
export function decodeTile(inflated, ifd) {
  const samples = ifd.samplesPerPixel;
  const tw = ifd.tileWidth; const th = ifd.tileHeight;
  if (ifd.bitsPerSample === 16) {
    const out = new Uint16Array(tw * th * samples);
    const view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    for (let i = 0; i < out.length && i * 2 + 1 < inflated.length; i++) out[i] = view.getUint16(i * 2, true);
    if (ifd.predictor === 2) {
      const row = tw * samples;
      for (let y = 0; y < th; y++) for (let i = samples; i < row; i++) out[y * row + i] = (out[y * row + i] + out[y * row + i - samples]) & 0xffff;
    }
    return out;
  }
  if (ifd.bitsPerSample === 8) {
    const out = new Uint8Array(tw * th * samples);
    out.set(inflated.subarray(0, out.length));
    if (ifd.predictor === 2) {
      const row = tw * samples;
      for (let y = 0; y < th; y++) for (let i = samples; i < row; i++) out[y * row + i] = (out[y * row + i] + out[y * row + i - samples]) & 0xff;
    }
    return out;
  }
  throw new Error(`Unsupported bits per sample ${ifd.bitsPerSample}`);
}

/** Browser inflate (zlib wrapper, TIFF compression 8). */
export async function inflateZlib(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads a single-sample pixel window (inclusive bounds may extend outside the
 * image; outside pixels stay 0 = nodata). `fetchRange(start, end)` -> bytes.
 */
export async function readWindow({ ifd, window, fetchRange, inflate, gap }) {
  if (ifd.compression !== 8 && ifd.compression !== 32946) throw new Error(`Unsupported compression ${ifd.compression}`);
  const w = window.c1 - window.c0 + 1; const h = window.r1 - window.r0 + 1;
  const out = ifd.bitsPerSample === 16 ? new Uint16Array(w * h) : new Uint8Array(w * h);
  const ranges = tileRanges(ifd, window, gap);
  await Promise.all(ranges.map(async (range) => {
    const bytes = await fetchRange(range.start, range.end);
    await Promise.all(range.tiles.map(async (tile) => {
      const rel = tile.offset - range.start;
      const data = decodeTile(await inflate(bytes.subarray(rel, rel + tile.count)), ifd);
      const x0 = tile.tx * ifd.tileWidth; const y0 = tile.ty * ifd.tileHeight;
      for (let ty = 0; ty < ifd.tileHeight; ty++) {
        const y = y0 + ty;
        if (y < window.r0 || y > window.r1 || y >= ifd.height) continue;
        for (let tx = 0; tx < ifd.tileWidth; tx++) {
          const x = x0 + tx;
          if (x < window.c0 || x > window.c1 || x >= ifd.width) continue;
          out[(y - window.r0) * w + (x - window.c0)] = data[ty * ifd.tileWidth + tx];
        }
      }
    }));
  }));
  return { width: w, height: h, data: out, requests: ranges.length };
}
