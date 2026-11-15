// Living Himalaya LOT 2: Terrarium (AWS Terrain Tiles / Tilezen joerd) helpers.
// Pure functions (decoding, Web Mercator tile maths, tile selection limits)
// plus a small LRU; the scene-side loader lives in terrain-overview.js.
// Terrarium PNG encoding: height (m) = R * 256 + G + B / 256 - 32768.
export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const TERRARIUM_ZOOMS = Object.freeze([6, 8, 9]);
export const OVERVIEW_REGION = Object.freeze({ latMin: 26, latMax: 46, lonMin: 67, lonMax: 103 });
export const TILE_SIZE = 256;

export function terrariumUrl(z, x, y) {
  return `${TERRARIUM_URL}/${z}/${x}/${y}.png`;
}

/** RGBA bytes -> heights (m), row-major from the north-west pixel. */
export function decodeTerrarium(rgba, width = TILE_SIZE, height = TILE_SIZE) {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = rgba[o] * 256 + rgba[o + 1] + rgba[o + 2] / 256 - 32768;
  }
  return out;
}

/** Inverse of decodeTerrarium for one value (tests). */
export function encodeTerrariumPixel(heightM) {
  const v = heightM + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.round((v - r * 256 - g) * 256);
  return [r, g, Math.min(255, b)];
}

export function lonToTileX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}
export function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
export function tileXToLon(x, z) {
  return (x / 2 ** z) * 360 - 180;
}
export function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function tileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

/** Tiles of zoom z that intersect the overview region. */
export function regionTiles(z, region = OVERVIEW_REGION) {
  const x0 = Math.floor(lonToTileX(region.lonMin, z));
  const x1 = Math.floor(lonToTileX(region.lonMax - 1e-9, z));
  const y0 = Math.floor(latToTileY(region.latMax, z));
  const y1 = Math.floor(latToTileY(region.latMin + 1e-9, z));
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  return out;
}

/** Children of a tile at the next allowed zoom (6 -> 8 gives 16, 8 -> 9 gives 4). */
export function childTiles(tile, region = OVERVIEW_REGION) {
  const next = TERRARIUM_ZOOMS[TERRARIUM_ZOOMS.indexOf(tile.z) + 1];
  if (!next) return [];
  const f = 2 ** (next - tile.z);
  const out = [];
  for (let dy = 0; dy < f; dy++) {
    for (let dx = 0; dx < f; dx++) {
      const child = { z: next, x: tile.x * f + dx, y: tile.y * f + dy };
      const b = tileBounds(child);
      if (b.lonMax > region.lonMin && b.lonMin < region.lonMax && b.latMax > region.latMin && b.latMin < region.latMax) out.push(child);
    }
  }
  return out;
}

export function tileBounds({ z, x, y }) {
  return { lonMin: tileXToLon(x, z), lonMax: tileXToLon(x + 1, z), latMax: tileYToLat(y, z), latMin: tileYToLat(y + 1, z) };
}

/** Least-recently-used map with an eviction callback. */
export function createLru(capacity, onEvict = () => {}) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    peek: (key) => map.get(key),
    has: (key) => map.has(key),
    set(key, value, { isPinned = () => false } = {}) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      if (map.size > capacity) {
        for (const [oldKey, oldValue] of map) {
          if (map.size <= capacity) break;
          if (oldKey === key || isPinned(oldKey)) continue;
          map.delete(oldKey);
          onEvict(oldKey, oldValue);
        }
      }
    },
    delete(key) {
      if (!map.has(key)) return false;
      const value = map.get(key);
      map.delete(key);
      onEvict(key, value);
      return true;
    },
    clear() {
      for (const [key, value] of map) onEvict(key, value);
      map.clear();
    },
    keys: () => [...map.keys()],
    get size() { return map.size; },
  };
}
