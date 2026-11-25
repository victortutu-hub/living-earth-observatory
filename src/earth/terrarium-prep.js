// LOT 42: Terrarium tile preparation, pure (no three.js, no DOM): it runs in terrarium-worker.js, off the main
// thread, and inline where workers are unavailable. Heights -> anomalies replaced -> east / north slopes over the
// real ground distance -> box-filtered mip chain -> half floats (RG16F). See terrarium-relief.js for the rules.
export const TERRAIN_TILE_SIZE = 256;
export const EARTH_RADIUS_KM = 6371;
export const TERRAIN_HEIGHT_BOUNDS_M = Object.freeze([-450, 8900]);
export const TERRAIN_SPIKE_MIN_M = 300;

/** Ground size (km) of a Terrarium pixel at a latitude (square: Web Mercator is conformal). */
export function mercatorPixelKm(level, lat) {
    return Math.cos(lat * Math.PI / 180) * 2 * Math.PI * EARTH_RADIUS_KM / (TERRAIN_TILE_SIZE * 2 ** level);
}

/** Ground size (m) of the pixels of row `row` of tile (level, y). */
export function rowPixelMetres(level, tileY, row, size = TERRAIN_TILE_SIZE) {
    const yMerc = tileY + (row + 0.5) / size;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * yMerc / 2 ** level))) * 180 / Math.PI;
    return mercatorPixelKm(level, lat) * 1000;
}

/**
 * Replaces voids and spikes: returns { heights, replaced }. A height outside `bounds`, or more than
 * max(spikeMinM, one pixel of ground distance) away from the median of its 8 neighbours, is replaced by the
 * median of its valid neighbours. The median test runs only where the 4-neighbour mean already differs by more
 * than half the threshold (cheap). `pixelMetres(row)` is the ground size of a pixel of that row.
 */
export function cleanTerrariumHeights(heights, size, pixelMetres, { bounds = TERRAIN_HEIGHT_BOUNDS_M, spikeMinM = TERRAIN_SPIKE_MIN_M } = {}) {
    const out = Float32Array.from(heights);
    const bad = new Uint8Array(size * size);
    const at = (x, y) => heights[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
    for (let y = 0; y < size; y++) {
        const threshold = Math.max(spikeMinM, pixelMetres(y));
        for (let x = 0; x < size; x++) {
            const h = heights[y * size + x];
            if (!(h >= bounds[0] && h <= bounds[1])) { bad[y * size + x] = 1; continue; }
            const mean4 = (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 4;
            if (Math.abs(h - mean4) <= threshold / 2) continue;
            const n = [at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1), at(x - 1, y), at(x + 1, y), at(x - 1, y + 1), at(x, y + 1), at(x + 1, y + 1)].sort((a, b) => a - b);
            if (Math.abs(h - (n[3] + n[4]) / 2) > threshold) bad[y * size + x] = 1;
        }
    }
    let replaced = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (!bad[y * size + x]) continue;
        const n = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; const yy = y + dy;
            if ((dx || dy) && xx >= 0 && yy >= 0 && xx < size && yy < size && !bad[yy * size + xx]) n.push(heights[yy * size + xx]);
        }
        n.sort((a, b) => a - b);
        out[y * size + x] = n.length ? (n.length % 2 ? n[(n.length - 1) / 2] : (n[n.length / 2 - 1] + n[n.length / 2]) / 2) : 0;
        replaced++;
    }
    return { heights: out, replaced };
}

/** East / north slopes (m/m), interleaved, from central differences over the real pixel distance; h < 0 -> 0 m. */
export function terrariumSlopes(heights, size, pixelMetres) {
    const out = new Float32Array(size * size * 2);
    const h = (x, y) => Math.max(0, heights[y * size + x]);
    for (let y = 0; y < size; y++) {
        const d = pixelMetres(y);
        const yn = Math.max(0, y - 1); const ys = Math.min(size - 1, y + 1);
        for (let x = 0; x < size; x++) {
            const xw = Math.max(0, x - 1); const xe = Math.min(size - 1, x + 1);
            out[(y * size + x) * 2] = (h(xe, y) - h(xw, y)) / ((xe - xw) * d);
            out[(y * size + x) * 2 + 1] = (h(x, yn) - h(x, ys)) / ((ys - yn) * d); // row 0 = north
        }
    }
    return out;
}

/** Box-filtered mip chain of an interleaved RG image, down to 1 x 1. */
export function slopeMipChain(rg, size) {
    const levels = [{ size, data: rg }];
    for (let s = size; s > 1; s >>= 1) {
        const src = levels[levels.length - 1].data; const n = s >> 1; const dst = new Float32Array(n * n * 2);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 2; c++) {
            const a = ((2 * y) * s + 2 * x) * 2 + c; const b = ((2 * y + 1) * s + 2 * x) * 2 + c;
            dst[(y * n + x) * 2 + c] = (src[a] + src[a + 2] + src[b] + src[b + 2]) / 4;
        }
        levels.push({ size: n, data: dst });
    }
    return levels;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** IEEE 754 binary16 bits of a number, rounded to nearest (three.js DataUtils.toHalfFloat truncates: <= 1 unit apart). */
export function toHalfBits(value) {
    f32[0] = value;
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const exp = (x >>> 23) & 0xff;
    let mant = x & 0x7fffff;
    if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // inf / NaN
    const e = exp - 127 + 15;
    if (e >= 31) return sign | 0x7c00; // overflow -> inf
    if (e <= 0) { // subnormal / zero
        if (e < -10) return sign;
        mant = (mant | 0x800000) >>> (1 - e);
        return sign | ((mant + 0x1000) >>> 13);
    }
    return sign | ((e << 10) + ((mant + 0x1000) >>> 13)); // a rounding carry moves into the exponent
}

/** Heights of one tile -> { levels: [{ size, data: Uint16Array (RG half floats) }], replaced }. */
export function prepareTerrainHeights(heights, size, level, tileY) {
    const pixelMetres = (row) => rowPixelMetres(level, tileY, row, size);
    const { heights: clean, replaced } = cleanTerrariumHeights(heights, size, pixelMetres);
    const levels = slopeMipChain(terrariumSlopes(clean, size, pixelMetres), size).map((l) => {
        const half = new Uint16Array(l.data.length);
        for (let i = 0; i < l.data.length; i++) half[i] = toHalfBits(l.data[i]);
        return { size: l.size, data: half };
    });
    return { levels, replaced };
}
