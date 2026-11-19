// Living Himalaya LOT 26: glacier outlines (RGI 7.0) — format, texts and pure geometry shared by
// tools/build-himalaya-glaciers.mjs (offline) and the page (no DOM, no network here).
//
// Asset assets/himalaya/glaciers-<hash>.bin:
//   'LHGL' | u32 version | u32 jsonBytes | JSON header (UTF-8) | sections (zstd)
//   header.patches[id].mask  = { offset, bytes, rawBytes }  R8, rows x cols, 1 = inside an outline,
//                              sampled at the GLO-30 grid points (1", RasterPixelIsPoint)
//   header.patches[id].lines = { offset, bytes, rawBytes }  repeated: u16 glacier (index into
//                              header.patches[id].glaciers), u16 n, n x (u16 x, u16 y) with
//                              x = column * QUANT, y = row * QUANT on the patch grid
// Outlines are RGI 7.0 polygons simplified with Douglas-Peucker (TOLERANCE_M), then clipped to the
// patch rectangle: a glacier that extends beyond it is "clipped" (its outline stops at the edge;
// no line is drawn along the edge).

export const GLACIERS_SCHEMA = 'lumi-himalaya-glaciers/1';
export const GLACIERS_MAGIC = 'LHGL';
export const GLACIERS_VERSION = 1;
export const TOLERANCE_M = 15;
export const QUANT = 64; // 1/64 of a grid step (~0.5 m)
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const LABELS_PER_PATCH = 8;
export const GLACIER_LABEL_MAX_KM = 25;
export const GLACIER_LIFT_M = 6;
export const ARCSEC_M = 30.87; // 1" of latitude in metres (mean)

// Line colours: cold cyan, distinct from the orange routes (#ff8a3d), the camp beige and the labels.
export const GLACIER_LINE = Object.freeze({
  casing: Object.freeze({ color: 0x0b2530, widthPx: 3.5, opacity: 0.55, renderOrder: 2 }),
  core: Object.freeze({ color: 0x7fe3ff, widthPx: 1.5, opacity: 0.95, renderOrder: 3 }),
});
export const GLACIER_TINT = Object.freeze({ color: [0.55, 0.86, 1.0], strength: 0.28 });

export const GLACIER_TEXT = Object.freeze({
  layer: 'Glacier outlines — RGI 7.0 (RGI 7.0 Consortium 2023, NSIDC), mapped from imagery around 2000; each outline keeps its own date. Observed, not current.',
  loading: 'loading glacier outlines…',
  unavailable: 'glacier outlines unavailable',
  noData: 'no RGI 7.0 outline on this detailed terrain',
  terrarium: 'Glacier outlines are drawn on the detailed terrain only.',
  clipped: 'outline clipped at the detailed terrain edge',
});

export const GLACIER_CITATION = 'RGI 7.0 Consortium, 2023. Randolph Glacier Inventory - A Dataset of Global Glacier Outlines, Version 7.0. Boulder, Colorado USA. NSIDC: National Snow and Ice Data Center. doi:10.5067/f6jmovy5navz.';
export const GLACIER_SUBSET = 'subset: regions 14–15, clipped to the summit patches, simplified at 15 m';
export const GLACIER_LICENSE_NOTE = 'No explicit license stated by NSIDC/data.gov; distributed openly by NSIDC with citation required';

/** "YYYY-MM-DD" from an RGI src_date ("1998-06-11T00:00:00"). */
export function outlineDay(srcDate) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(srcDate || ''));
  return m ? m[1] : null;
}

/** Label: "<glac_name or RGI id> · outline <date>" (+ the clipped note). */
export function glacierLabel(glacier, { clipped = false } = {}) {
  const name = glacier.name || glacier.id;
  const date = glacier.date ? `outline ${glacier.date}` : 'outline date unknown';
  return `${name} · ${date}${clipped ? ` · ${GLACIER_TEXT.clipped}` : ''}`;
}

/**
 * LOT 27: short map label "<name or RGI id> · <year> · clipped" (the last part only when the outline
 * is clipped). The full label (glacierLabel: complete date, clipped note) stays in the panel and in
 * the label's title.
 */
export function glacierShortLabel(glacier, { clipped = false } = {}) {
  const year = /^(\d{4})/.exec(glacier.date || '')?.[1] || 'date unknown';
  return `${glacier.name || glacier.id} · ${year}${clipped ? ' · clipped' : ''}`;
}

/** "1998-06-11" or "1998-06-11 to 2001-12-20" for the outlines of a patch. */
export function outlineDates(dateMin, dateMax) {
  if (!dateMin) return 'an undated image';
  return !dateMax || dateMax === dateMin ? dateMin : `${dateMin} to ${dateMax}`;
}

/** Panel note while the switch is on (imageDate: the Sentinel-2 scene on screen, or null in Lit terrain). */
export function glacierPanelNote({ outlineDate, imageDate }) {
  if (!imageDate) return `Outline: RGI 7.0, mapped on ${outlineDate || 'an undated image'}. Switch to Satellite to compare it with a recent Sentinel-2 image of the ice.`;
  return `Outline: RGI 7.0, mapped on ${outlineDate || 'an undated image'}. The Sentinel-2 image shows the ice of ${imageDate}: where they differ, the glacier has changed since the outline was drawn — or snow and debris hid its edge.`;
}

/** Panel rows for the active patch (header = decoded asset header). */
export function glacierSectionRows({ peakId, patchId, header, status, show, terrainMode }) {
  if (!show) return [];
  if (status === 'loading') return [['Glaciers', GLACIER_TEXT.loading, 'loading']];
  if (status === 'error') return [['Glaciers', GLACIER_TEXT.unavailable, 'error']];
  const info = header?.patches?.[patchId || peakId];
  if (!info?.glaciers?.length) return [['Glaciers', GLACIER_TEXT.noData, 'missing']];
  // LOT 27: the panel keeps the full label (complete outline date, clipped note) of the largest glaciers.
  const largest = info.glaciers.map((e) => ({ e, g: header.glaciers[e.g] })).sort((a, b) => b.g.areaKm2 - a.g.areaKm2).slice(0, 3)
    .map(({ e, g }) => `${glacierLabel(g, { clipped: e.clipped })} (${g.areaKm2.toLocaleString('en-US', { maximumFractionDigits: 1 })} km² total)`).join('; ');
  const rows = [
    ['Outlines', `${info.glaciers.length} RGI 7.0 glaciers touch the detailed terrain (${info.clippedCount} clipped at its edge)`],
    ['Ice within the terrain', `${info.insideAreaKm2.toLocaleString('en-US')} km² (from the outline mask)`],
    ['Outline dates', outlineDates(info.dateMin, info.dateMax)],
    ['Largest', largest],
  ];
  if (terrainMode === 'terrarium') rows.push(['Shown', GLACIER_TEXT.terrarium, 'missing']);
  return rows;
}

/** Switch note (like routes): empty while off. */
export function glacierSwitchNote({ show, status, peakId, data, terrainMode }) {
  if (!show) return '';
  if (status === 'loading') return `Glaciers: ${GLACIER_TEXT.loading}`;
  if (status === 'error') return `Glaciers: ${GLACIER_TEXT.unavailable}.`;
  if (!peakId) return 'Glaciers: select a summit.';
  if (status === 'ready' && !data?.patches?.[peakId]?.glaciers?.length) return `Glaciers: ${GLACIER_TEXT.noData}.`;
  if (terrainMode === 'terrarium') return GLACIER_TEXT.terrarium;
  return '';
}

/** The asset is fetched only once the switch is on (zero cost while off). */
export function wantsGlacierData({ show, status }) {
  return Boolean(show) && status === 'idle';
}

/** Provenance-bar segment, only while the switch is on. */
export function glaciersBarSegment({ show }) {
  return show ? 'Glaciers: RGI 7.0 outlines (observed, dated ~1992–2010)' : null;
}

// --- binary asset -----------------------------------------------------------------------------

/** Parses the asset; `zstd.decode(Uint8Array) -> Uint8Array`. Returns { header, mask(id), lines(id) }. */
export function decodeGlaciersAsset(buffer, zstd) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== GLACIERS_MAGIC) throw new Error('Not a glacier outline asset.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== GLACIERS_VERSION) throw new Error(`Unsupported glacier asset version ${version}.`);
  const jsonBytes = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + jsonBytes)));
  if (header.schema !== GLACIERS_SCHEMA) throw new Error('Unexpected glacier asset schema.');
  const base = 12 + jsonBytes;
  const section = ({ offset, bytes: n, rawBytes }) => {
    const out = zstd.decode(bytes.subarray(base + offset, base + offset + n));
    if (out.length !== rawBytes) throw new Error('Glacier asset section has an unexpected size.');
    return out;
  };
  return {
    header,
    mask(id) { const p = header.patches[id]; return p ? section(p.mask) : null; },
    lines(id) { const p = header.patches[id]; return p ? decodeLines(section(p.lines)) : null; },
  };
}

/** Lines section -> [{ glacier, points: Float32Array (col, row, col, row, ...) }]. */
export function decodeLines(raw) {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = [];
  for (let o = 0; o + 4 <= raw.length;) {
    const glacier = view.getUint16(o, true); const n = view.getUint16(o + 2, true); o += 4;
    const points = new Float32Array(n * 2);
    for (let k = 0; k < n * 2; k++, o += 2) points[k] = view.getUint16(o, true) / QUANT;
    out.push({ glacier, points });
  }
  return out;
}

export function encodeLines(polylines) {
  const size = polylines.reduce((s, p) => s + 4 + p.points.length * 2, 0);
  const raw = new Uint8Array(size);
  const view = new DataView(raw.buffer);
  let o = 0;
  for (const { glacier, points } of polylines) {
    const n = points.length / 2;
    if (n > 0xffff || glacier > 0xffff) throw new Error('Polyline too long for the u16 format.');
    view.setUint16(o, glacier, true); view.setUint16(o + 2, n, true); o += 4;
    for (let k = 0; k < points.length; k++, o += 2) {
      const q = Math.round(points[k] * QUANT);
      if (q < 0 || q > 0xffff) throw new Error(`Quantized coordinate out of range: ${points[k]}`);
      view.setUint16(o, q, true);
    }
  }
  return raw;
}

// --- geometry (offline + tests) ---------------------------------------------------------------

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas-Peucker on an open polyline (metric x, y pairs); keeps the end points. */
export function douglasPeucker(points, tolerance) {
  const n = points.length / 2;
  if (n <= 2) return Float64Array.from(points);
  const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1; let dmax = 0;
    for (let k = a + 1; k < b; k++) {
      const d = segmentDistance(points[k * 2], points[k * 2 + 1], points[a * 2], points[a * 2 + 1], points[b * 2], points[b * 2 + 1]);
      if (d > dmax) { dmax = d; best = k; }
    }
    if (best >= 0 && dmax > tolerance) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(points[k * 2], points[k * 2 + 1]);
  return Float64Array.from(out);
}

/** Closed ring (first point not repeated at the end): split at the farthest point, simplify both halves. */
export function simplifyRing(ring, tolerance) {
  const n = ring.length / 2;
  if (n <= 4) return Float64Array.from(ring);
  let far = 0; let dmax = -1;
  for (let k = 1; k < n; k++) { const d = Math.hypot(ring[k * 2] - ring[0], ring[k * 2 + 1] - ring[1]); if (d > dmax) { dmax = d; far = k; } }
  const first = douglasPeucker(ring.slice(0, far * 2 + 2), tolerance);
  const second = douglasPeucker(Float64Array.from([...ring.slice(far * 2), ring[0], ring[1]]), tolerance);
  return Float64Array.from([...first, ...second.slice(2, -2)]);
}

/** Largest distance from any original vertex to the simplified closed ring (metric). */
export function maxRingDeviation(original, simplified) {
  const m = simplified.length / 2;
  let worst = 0;
  for (let k = 0; k < original.length; k += 2) {
    let best = Infinity;
    for (let s = 0; s < m; s++) {
      const t = (s + 1) % m;
      best = Math.min(best, segmentDistance(original[k], original[k + 1], simplified[s * 2], simplified[s * 2 + 1], simplified[t * 2], simplified[t * 2 + 1]));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/**
 * Clips a closed ring to the rectangle [0, maxX] x [0, maxY] as polylines (Liang-Barsky per
 * segment). No segment is added along the rectangle edge. Returns { polylines, clipped }.
 */
export function clipRingToRect(ring, maxX, maxY) {
  const n = ring.length / 2;
  const polylines = [];
  let current = null;
  let clipped = false;
  for (let k = 0; k < n; k++) {
    const ax = ring[k * 2]; const ay = ring[k * 2 + 1];
    const bx = ring[((k + 1) % n) * 2]; const by = ring[((k + 1) % n) * 2 + 1];
    let t0 = 0; let t1 = 1; const dx = bx - ax; const dy = by - ay;
    let visible = true;
    for (const [p, q] of [[-dx, ax], [dx, maxX - ax], [-dy, ay], [dy, maxY - ay]]) {
      if (p === 0) { if (q < 0) { visible = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { visible = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { visible = false; break; } if (r < t1) t1 = r; }
    }
    if (!visible) { clipped = true; if (current) { polylines.push(current); current = null; } continue; }
    const sx = ax + t0 * dx; const sy = ay + t0 * dy; const ex = ax + t1 * dx; const ey = ay + t1 * dy;
    if (t0 > 0 || t1 < 1) clipped = true;
    if (!current || t0 > 0) { if (current) polylines.push(current); current = [sx, sy]; }
    current.push(ex, ey);
    if (t1 < 1) { polylines.push(current); current = null; }
  }
  if (current) {
    // A ring entirely inside: close it; otherwise join the last run with the first if they meet.
    if (!clipped) polylines.push(current); // entirely inside: the last segment already closed the ring
    else if (polylines.length && polylines[0][0] === current.at(-2) && polylines[0][1] === current.at(-1)) polylines[0] = [...current, ...polylines[0].slice(2)];
    else polylines.push(current);
  }
  return { polylines: polylines.filter((p) => p.length >= 4).map((p) => Float64Array.from(p)), clipped };
}

/**
 * Even-odd scanline mask of `rings` (grid coordinates: x = column, y = row) sampled at the grid
 * points; adjacent outlines sharing an edge stay filled. Returns Uint8Array rows x cols (1 = inside).
 */
export function rasterizeRings(rings, rows, cols) {
  const mask = new Uint8Array(rows * cols);
  const edges = [];
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let k = 0; k < n; k++) {
      const ax = ring[k * 2]; const ay = ring[k * 2 + 1]; const bx = ring[((k + 1) % n) * 2]; const by = ring[((k + 1) % n) * 2 + 1];
      if (ay !== by) edges.push(ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay]);
    }
  }
  edges.sort((a, b) => a[1] - b[1]);
  const active = [];
  let next = 0;
  for (let j = 0; j < rows; j++) {
    while (next < edges.length && edges[next][1] <= j) active.push(edges[next++]);
    const xs = [];
    for (let e = active.length - 1; e >= 0; e--) {
      const [ax, ay, bx, by] = active[e];
      if (by <= j) { active.splice(e, 1); continue; }
      if (ay <= j) xs.push(ax + ((j - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k])); const to = Math.min(cols - 1, Math.floor(xs[k + 1]));
      for (let i = from; i <= to; i++) mask[j * cols + i] = 1;
    }
  }
  return mask;
}
