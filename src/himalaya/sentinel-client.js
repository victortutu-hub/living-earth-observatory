// Living Himalaya LOT 4: reads Sentinel-2 L2A for ONE summit at a time,
// directly from the browser: STAC search (Earth Search), SCL for the local
// cloud share, B04/B03/B02 COG windows by HTTP range requests through the
// shared request runtime. The selection (STAC + SCL result) is kept in
// sessionStorage for 30 min per summit; pixels are not (memory only, owned by
// the caller's LRU). Every call takes an AbortSignal.
import { createRequestRuntime } from '../core/runtime/request-runtime.js';
import { HeaderTooShortError, inflateZlib, parseCogHeader, readWindow } from './cog-reader.js';
import { utmForward, utmZone } from './utm.js';
import {
  LEVEL_40M, STAC_SEARCH_URL, composeMosaic, groupPasses, imageGrid, parseStacItems, sclCloudShare,
  selectPass, sourceWindow, stacSearchBody, stretchLut,
} from './sentinel-scene.js';

export const SELECTION_TTL_MS = 30 * 60_000;
const NON_PERSISTENT_CACHE = Object.freeze({
  get: async () => null,
  set: async (key, value, meta = {}) => ({ key, value, storedAt: Date.now(), ...meta }),
  touch: async () => null,
});

/** Patch corners and edge midpoints (lon/lat) from the GLO-30 patch metadata. */
export function patchOutline(meta) {
  const top = meta.latTopArcsec / 3600; const bottom = (meta.latTopArcsec - meta.rows + 1) / 3600;
  const left = meta.lonLeftArcsec / 3600; const right = (meta.lonLeftArcsec + meta.cols - 1) / 3600;
  const midLat = (top + bottom) / 2; const midLon = (left + right) / 2;
  return {
    ring: [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]],
    points: [[left, top], [midLon, top], [right, top], [right, midLat], [right, bottom], [midLon, bottom], [left, bottom], [left, midLat], [midLon, midLat]],
    samples: Array.from({ length: 25 }, (_, k) => [left + ((k % 5) / 4) * (right - left), bottom + (Math.floor(k / 5) / 4) * (top - bottom)]),
  };
}

function stripPass(pass) {
  if (!pass) return null;
  return { ...pass, tiles: pass.tiles.map(({ geometry, ...tile }) => tile) };
}

export function createSentinelClient({
  runtime = createRequestRuntime({ cache: NON_PERSISTENT_CACHE }), inflate = inflateZlib,
  storage = globalThis.sessionStorage, now = () => new Date(),
} = {}) {
  const headers = new Map();
  let requests = 0;

  async function bytes(url, start, end, signal) {
    requests += 1;
    const result = await runtime.fetchResource({
      key: `s2:${url}:${start}-${end}`, url, responseType: 'arrayBuffer', ttl: 0, staleTtl: 0, retries: 1, timeout: 30_000, signal,
      fetchOptions: { headers: { Range: `bytes=${start}-${end}` } },
    });
    return new Uint8Array(result.data);
  }

  async function header(url, signal) {
    if (!headers.has(url)) {
      const promise = (async () => {
        try { return parseCogHeader(await bytes(url, 0, 16383, signal)); } catch (error) {
          if (!(error instanceof HeaderTooShortError)) throw error;
          return parseCogHeader(await bytes(url, 0, 131071, signal));
        }
      })();
      headers.set(url, promise);
      promise.catch(() => headers.delete(url));
    }
    return headers.get(url);
  }

  function readCached(peakId) {
    try {
      const raw = storage?.getItem(`lumi-himalaya:s2-selection:${peakId}`);
      const record = raw ? JSON.parse(raw) : null;
      return record && now().getTime() - record.storedAt <= SELECTION_TTL_MS ? record : null;
    } catch (_) { return null; }
  }
  function writeCached(peakId, value) {
    try { storage?.setItem(`lumi-himalaya:s2-selection:${peakId}`, JSON.stringify({ storedAt: now().getTime(), value })); } catch (_) { /* quota: no cache */ }
  }

  /** Local SCL cloud share (40 m SCL level) of a pass over the patch, plus per tile. */
  async function localCloud(pass, outline, zone, signal) {
    const utmPoints = outline.points.map(([lon, lat]) => utmForward(lat, lon, zone));
    const ordered = [...pass.tiles].sort((a, b) => a.cloudPct - b.cloudPct);
    const first = await header(ordered[0].assets.scl, signal);
    const level = first[Math.min(1, first.length - 1)];
    const extent = imageGrid(utmPoints, level.origin, level.resolution);
    const res = level.resolution;
    const width = Math.round(extent.widthM / res); const height = Math.round(extent.heightM / res);
    const union = new Uint8Array(width * height);
    for (const tile of ordered) {
      const ifds = await header(tile.assets.scl, signal);
      const ifd = ifds[Math.min(1, ifds.length - 1)];
      const win = sourceWindow(extent, ifd.origin, ifd.resolution);
      const { data, width: ww } = await readWindow({ ifd, window: win, inflate, fetchRange: (s, e) => bytes(tile.assets.scl, s, e, signal) });
      const own = [];
      for (let row = 0; row < height; row++) {
        const n = extent.n0 - (row + 0.5) * res;
        const r = Math.floor((ifd.origin.n - n) / ifd.resolution) - win.r0;
        for (let col = 0; col < width; col++) {
          const e = extent.e0 + (col + 0.5) * res;
          const c = Math.floor((e - ifd.origin.e) / ifd.resolution) - win.c0;
          const v = data[r * ww + c] || 0;
          if (v) own.push(v);
          if (!union[row * width + col] && v) union[row * width + col] = v;
        }
      }
      tile.localCloudPct = sclCloudShare(own);
    }
    return sclCloudShare(union);
  }

  return Object.freeze({
    get requests() { return requests; },

    /** { status: 'clear' | 'none', pass | best, fromCache } for the summit. */
    async select(peak, meta, signal) {
      const cached = readCached(peak.id);
      if (cached) return { ...cached.value, fromCache: true, cacheAgeMs: now().getTime() - cached.storedAt };
      const outline = patchOutline(meta);
      const zone = utmZone(peak.lon);
      const stac = await runtime.fetchResource({
        key: `s2-stac:${peak.id}:${now().toISOString().slice(0, 13)}`, url: STAC_SEARCH_URL, responseType: 'json', ttl: 0, staleTtl: 0, retries: 1, timeout: 30_000, signal,
        fetchOptions: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stacSearchBody(outline.ring, now())) },
      });
      requests += 1;
      const passes = groupPasses(parseStacItems(stac.data), zone, outline.samples);
      const result = await selectPass(passes, (pass) => localCloud(pass, outline, zone, signal));
      const value = { status: result.status, zone, pass: stripPass(result.pass || null), best: stripPass(result.best || null), passes: passes.length, evaluated: result.evaluated };
      writeCached(peak.id, value);
      return { ...value, fromCache: false };
    },

    /** RGBA mosaic for one pass at one COG level (2 = 40 m, 1 = 20 m). */
    async image(peak, meta, pass, levelIndex, signal) {
      const zone = utmZone(peak.lon);
      const outline = patchOutline(meta);
      const utmPoints = outline.points.map(([lon, lat]) => utmForward(lat, lon, zone));
      const ordered = [...pass.tiles].sort((a, b) => (a.localCloudPct ?? 100) - (b.localCloudPct ?? 100));
      const primaryHeaders = await header(ordered[0].assets.red, signal);
      const extent = imageGrid(utmPoints, primaryHeaders[LEVEL_40M].origin, primaryHeaders[LEVEL_40M].resolution);
      const res = primaryHeaders[levelIndex].resolution;
      const sources = await Promise.all(ordered.map(async (tile) => {
        const bandUrls = [tile.assets.red, tile.assets.green, tile.assets.blue];
        const bands = await Promise.all(bandUrls.map(async (url) => {
          const ifd = (await header(url, signal))[levelIndex];
          const win = sourceWindow(extent, ifd.origin, ifd.resolution);
          return { ifd, win, ...(await readWindow({ ifd, window: win, inflate, fetchRange: (s, e) => bytes(url, s, e, signal) })) };
        }));
        const { ifd, win } = bands[0];
        const full = (await header(tile.assets.red, signal))[0];
        return {
          tile: tile.tile, bands: bands.map((b) => b.data), width: bands[0].width, height: bands[0].height, res: ifd.resolution,
          e0: ifd.origin.e + win.c0 * ifd.resolution, n0: ifd.origin.n - win.r0 * ifd.resolution,
          rect: { e0: full.origin.e, e1: full.origin.e + full.width * full.resolution, n0: full.origin.n, n1: full.origin.n - full.height * full.resolution },
        };
      }));
      const lut = stretchLut(ordered[0].scaling);
      const mosaic = composeMosaic({ extent, res, sources, lut });
      return { ...mosaic, level: levelIndex, res, utm: { zone, ...extent }, tiles: ordered.map((t) => t.tile), scaling: ordered[0].scaling,
        reflectanceSamples: summitReflectance(sources[0], extent, res, utmForward(peak.lat, peak.lon, zone), ordered[0].scaling) };
    },
  });
}

/** Reflectance percentiles (max of R,G,B) within ±2 km of the summit, from the primary source (white-point evidence). */
export function summitReflectance(source, extent, res, summit, scaling) {
  const values = [];
  const half = 2000;
  for (let n = summit.n - half; n <= summit.n + half; n += res) {
    for (let e = summit.e - half; e <= summit.e + half; e += res) {
      const c = Math.floor((e - source.e0) / source.res); const r = Math.floor((source.n0 - n) / source.res);
      if (c < 0 || r < 0 || c >= source.width || r >= source.height) continue;
      const i = r * source.width + c;
      const dn = Math.max(source.bands[0][i], source.bands[1][i], source.bands[2][i]);
      if (dn > 0) values.push(dn * scaling.scale + scaling.offset);
    }
  }
  values.sort((a, b) => a - b);
  const q = (p) => (values.length ? +values[Math.min(values.length - 1, Math.floor(p * values.length))].toFixed(3) : null);
  return { count: values.length, p50: q(0.5), p90: q(0.9), p95: q(0.95), p99: q(0.99), max: values.length ? +values.at(-1).toFixed(3) : null };
}
