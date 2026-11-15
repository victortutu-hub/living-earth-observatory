// Living Himalaya LOT 2: pure (three.js-free) grid maths for one Copernicus
// GLO-30 patch: vertex positions in the azimuthal equidistant scene plane,
// normals, two triangle index sets (FULL every sample, COARSE every 2nd
// row/column with the borders kept) and the vertical skirt along the border.
// Wrapped into a BufferGeometry by terrain-patch.js.
import { projectLonLat, heightKm } from './projection.js';
import { readKtx2R16Unorm, dequantizeHeights } from './ktx2-r16-reader.js';

export const SKIRT_DEPTH_KM = 0.6;

/** Row/column indices for a stride, always ending on the last one. */
export function strideIndices(count, stride) {
  const out = [];
  for (let i = 0; i < count; i += stride) out.push(i);
  if (out[out.length - 1] !== count - 1) out.push(count - 1);
  return out;
}

/** Triangle indices over the selected rows/cols plus the skirt walls. */
export function gridIndices(cols, rowList, colList, skirtBase, borderLoop) {
  const cells = (rowList.length - 1) * (colList.length - 1);
  const out = new Uint32Array(cells * 6 + borderLoop.length * 12);
  let o = 0;
  for (let r = 0; r < rowList.length - 1; r++) {
    for (let c = 0; c < colList.length - 1; c++) {
      const a = rowList[r] * cols + colList[c]; const b = rowList[r] * cols + colList[c + 1];
      const d0 = rowList[r + 1] * cols + colList[c]; const d1 = rowList[r + 1] * cols + colList[c + 1];
      out[o++] = a; out[o++] = d0; out[o++] = b; out[o++] = b; out[o++] = d0; out[o++] = d1;
    }
  }
  for (let k = 0; k < borderLoop.length; k++) {
    const A = borderLoop[k].vertex; const B = borderLoop[(k + 1) % borderLoop.length].vertex;
    const A2 = skirtBase + borderLoop[k].loopIndex; const B2 = skirtBase + borderLoop[(k + 1) % borderLoop.length].loopIndex;
    out[o++] = A; out[o++] = B; out[o++] = A2; out[o++] = B; out[o++] = B2; out[o++] = A2;
    // Reverse winding too: the skirt closes the seam seen from inside or outside.
    out[o++] = A; out[o++] = A2; out[o++] = B; out[o++] = B; out[o++] = A2; out[o++] = B2;
  }
  return out.subarray(0, o);
}

function borderLoopFor(rows, cols, rowList, colList, fullLoopIndex) {
  const loop = [];
  const push = (r, c) => { const vertex = r * cols + c; loop.push({ vertex, loopIndex: fullLoopIndex.get(vertex) }); };
  for (let k = 0; k < colList.length - 1; k++) push(0, colList[k]);
  for (let k = 0; k < rowList.length - 1; k++) push(rowList[k], cols - 1);
  for (let k = colList.length - 1; k > 0; k--) push(rows - 1, colList[k]);
  for (let k = rowList.length - 1; k > 0; k--) push(rowList[k], 0);
  return loop;
}

/**
 * Builds the patch geometry. `meta` = HIMALAYA_TERRAIN_PATCHES entry,
 * `heights` = metres (row-major from the north-west sample).
 */
export function buildPatchArrays(meta, heights, center) {
  const { rows, cols } = meta;
  const n = rows * cols;
  const fullRows = strideIndices(rows, 1); const fullCols = strideIndices(cols, 1);
  const fullLoop = borderLoopFor(rows, cols, fullRows, fullCols, new Map());
  const loopIndex = new Map(fullLoop.map((entry, k) => [entry.vertex, k]));
  fullLoop.forEach((entry, k) => { entry.loopIndex = k; });
  const positions = new Float32Array((n + fullLoop.length) * 3);
  const lons = new Float64Array(cols);
  for (let i = 0; i < cols; i++) lons[i] = (meta.lonLeftArcsec + i) / 3600;
  for (let j = 0; j < rows; j++) {
    const lat = (meta.latTopArcsec - j) / 3600;
    for (let i = 0; i < cols; i++) {
      const p = projectLonLat(lons[i], lat, center);
      const o = (j * cols + i) * 3;
      positions[o] = p.x; positions[o + 1] = heightKm(heights[j * cols + i]); positions[o + 2] = p.z;
    }
  }
  // Normals by central differences on the grid: n = dSouth x dEast.
  const normals = new Float32Array(positions.length);
  const at = (j, i) => (Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))) * 3;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const e = at(j, i + 1); const w = at(j, i - 1); const s = at(j + 1, i); const nn = at(j - 1, i);
      const ex = positions[e] - positions[w]; const ey = positions[e + 1] - positions[w + 1]; const ez = positions[e + 2] - positions[w + 2];
      const sx = positions[s] - positions[nn]; const sy = positions[s + 1] - positions[nn + 1]; const sz = positions[s + 2] - positions[nn + 2];
      let nx = sy * ez - sz * ey; let ny = sz * ex - sx * ez; let nz = sx * ey - sy * ex;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const o = (j * cols + i) * 3;
      normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = nz;
    }
  }
  fullLoop.forEach((entry, k) => {
    const src = entry.vertex * 3; const dst = (n + k) * 3;
    positions[dst] = positions[src]; positions[dst + 1] = positions[src + 1] - SKIRT_DEPTH_KM; positions[dst + 2] = positions[src + 2];
    normals[dst] = normals[src]; normals[dst + 1] = normals[src + 1]; normals[dst + 2] = normals[src + 2];
  });
  const full = gridIndices(cols, fullRows, fullCols, n, fullLoop);
  const coarseRows = strideIndices(rows, 2); const coarseCols = strideIndices(cols, 2);
  const coarse = gridIndices(cols, coarseRows, coarseCols, n, borderLoopFor(rows, cols, coarseRows, coarseCols, loopIndex));
  return { positions, normals, full, coarse, vertexCount: n + fullLoop.length };
}

/**
 * Patch corners (NW, NE, SE, SW) in scene xz, for the overview clip quad. The
 * quad is inset by 12" (~370 m) so the overview still runs under the patch
 * border: where Terrarium and GLO-30 disagree there is overlap, never a gap.
 */
export const CLIP_INSET_ARCSEC = 12;
export function patchCornersXZ(meta, center, insetArcsec = CLIP_INSET_ARCSEC) {
  const top = (meta.latTopArcsec - insetArcsec) / 3600; const bottom = (meta.latTopArcsec - meta.rows + 1 + insetArcsec) / 3600;
  const left = (meta.lonLeftArcsec + insetArcsec) / 3600; const right = (meta.lonLeftArcsec + meta.cols - 1 - insetArcsec) / 3600;
  return [[left, top], [right, top], [right, bottom], [left, bottom]].map(([lon, lat]) => projectLonLat(lon, lat, center));
}

/** Decodes the KTX2 bytes against the frozen metadata (offset/scale must match). */
export function decodePatch(bytes, meta, zstd) {
  const decoded = readKtx2R16Unorm(bytes, zstd);
  const offset = Number(decoded.keyValues['LUMI.heightOffsetM']);
  const scale = Number(decoded.keyValues['LUMI.heightScaleM']);
  if (decoded.width !== meta.cols || decoded.height !== meta.rows) throw new Error('Patch size does not match its metadata.');
  if (offset !== meta.heightOffsetM || scale !== meta.heightScaleM) throw new Error('Patch offset/scale do not match its metadata.');
  return { heights: dequantizeHeights(decoded.data, offset, scale), keyValues: decoded.keyValues };
}
