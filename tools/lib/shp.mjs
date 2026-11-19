// LOT 26: minimal ESRI Shapefile (.shp) polygon reader for offline tools (no dependency).
// Main file header: 100 bytes, file code 9994 (big-endian), file length in 16-bit words
// (big-endian), version 1000 and shape type (little-endian). Each record: number and content
// length (big-endian, 16-bit words), then the content: shape type (LE int), bounding box
// (4 LE doubles: xmin, ymin, xmax, ymax), numParts, numPoints, parts[] (start index of each
// ring) and points[] (x, y LE doubles). Polygon (5) and PolygonZ/PolygonM (15/25: the extra
// Z/M arrays are ignored). Null shapes (0) yield an empty ring list.
// Coordinates are returned as stored (for RGI 7.0: WGS 84 longitude / latitude, see the .prj).

export const SHP_TYPES = Object.freeze({ 0: 'null', 5: 'polygon', 15: 'polygonZ', 25: 'polygonM' });

/** File header: { fileLength (bytes), shapeType, bbox: [xmin, ymin, xmax, ymax] }. */
export function readShpHeader(buffer) {
  if (buffer.readInt32BE(0) !== 9994) throw new Error('Not a shapefile (file code 9994 expected).');
  const version = buffer.readInt32LE(28);
  if (version !== 1000) throw new Error(`Unsupported shapefile version ${version}.`);
  return {
    fileLength: buffer.readInt32BE(24) * 2,
    shapeType: buffer.readInt32LE(32),
    bbox: [buffer.readDoubleLE(36), buffer.readDoubleLE(44), buffer.readDoubleLE(52), buffer.readDoubleLE(60)],
  };
}

/**
 * Iterates the records: { index (0-based, same order as the .dbf), bbox, rings: Float64Array[]
 * (x0, y0, x1, y1, ...) }. `filter(bbox, index)` may skip a record before its points are read.
 */
export function* readShpPolygons(buffer, { filter = null } = {}) {
  const header = readShpHeader(buffer);
  if (![5, 15, 25].includes(header.shapeType)) throw new Error(`Unsupported shape type ${header.shapeType} (polygons only).`);
  let offset = 100;
  let index = 0;
  const end = Math.min(buffer.length, header.fileLength);
  while (offset + 8 <= end) {
    const contentLength = buffer.readInt32BE(offset + 4) * 2;
    const content = offset + 8;
    const type = buffer.readInt32LE(content);
    if (type === 0) {
      yield { index, bbox: null, rings: [] };
    } else {
      if (![5, 15, 25].includes(type)) throw new Error(`Record ${index}: unsupported shape type ${type}.`);
      const bbox = [buffer.readDoubleLE(content + 4), buffer.readDoubleLE(content + 12), buffer.readDoubleLE(content + 20), buffer.readDoubleLE(content + 28)];
      if (!filter || filter(bbox, index)) {
        const numParts = buffer.readInt32LE(content + 36);
        const numPoints = buffer.readInt32LE(content + 40);
        const partsAt = content + 44;
        const pointsAt = partsAt + numParts * 4;
        const starts = [];
        for (let p = 0; p < numParts; p++) starts.push(buffer.readInt32LE(partsAt + p * 4));
        starts.push(numPoints);
        const rings = [];
        for (let p = 0; p < numParts; p++) {
          const ring = new Float64Array((starts[p + 1] - starts[p]) * 2);
          for (let k = starts[p], q = 0; k < starts[p + 1]; k++, q += 2) {
            ring[q] = buffer.readDoubleLE(pointsAt + k * 16);
            ring[q + 1] = buffer.readDoubleLE(pointsAt + k * 16 + 8);
          }
          rings.push(ring);
        }
        yield { index, bbox, rings };
      }
    }
    offset = content + contentLength;
    index++;
  }
}
