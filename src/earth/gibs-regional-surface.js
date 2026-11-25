// LOT 41: regional detail for the Blue Marble NG surface (step A of LOT 40). The global surface stays the z3
// mosaic (4096 x 2048, ~9.8 km per texel); close to the globe, deeper WMTS tiles of the SAME product (z4-z5,
// z6 on a high-density screen; z5 at most on a touch device) are loaded for the visible area only and blended
// over it in the shader. Same product, same JPEG pyramid, same sRGB decoding: no colour change, only detail.
//
//   Selection   rays through a grid of the viewport hit the globe (in the Earth mesh frame); the footprint of
//               one device pixel picks the level (the coarsest whose texel is <= the finest footprint); the
//               tiles hit where z3 is coarser than a pixel form a window of at most S x S tiles around the
//               closest point. Nothing is selected at distance >= REGIONAL_POLICY.activationDistance.
//   Debounce    a new window is applied only after it has been the same for debounceMs (a drag or a fast zoom
//               requests nothing until the view settles; the slow auto-rotation changes it every few seconds).
//   Requests    the shared request runtime (gibs-tile-loader.js) through loadTileWithRetry, at most
//               `concurrency` in flight; each tile has its own AbortController under the layer's signal: tiles
//               that leave the window, a move beyond the activation distance and dispose abort them.
//   Atlas       one fixed texture of S x S slots of 512 px (desktop 8 x 8 = 4096^2, touch 4 x 4 = 2048^2), sRGB,
//               mipmapped, allocated on first use. A tile goes to slot (x mod S, y mod S) of its unwrapped window
//               column/row; an S x S slot table (x, y, level, fade) tells the shader what each slot holds, so a
//               stale or missing slot is never drawn (z3 shows there). Uploads: copyTextureToTexture, at most
//               uploadsPerFrame per frame, mipmaps regenerated once per frame.
//   LRU         decoded tiles kept for a quick return (LruTileCache, the bitmap is closed on eviction).
//   Blend       weight = slot match x fade-in x window-edge fade x resolution fade (none once a screen pixel
//               covers a z3 texel) x distance fade (0 at the activation distance). Off -> the shader skips it.
import { GIBS_LAYERS, GIBS_TILE_SIZE, LruTileCache, gibsTileUrl, loadTileWithRetry, tileGridDimensions } from './gibs-tiles.js';
import { loadGibsTileBitmap } from './gibs-tile-loader.js';
import { createPriorityLimiter } from './gibs-surface.js';

export const REGIONAL_LAYER = GIBS_LAYERS.blueMarble;
const KM_PER_DEG = 111.195;
/** The global surface: z3 resampled to 4096 px over 360 deg. */
export const REGIONAL_BASE_TEXEL_DEG = 360 / 4096;
export const REGIONAL_BASE_TEXEL_KM = REGIONAL_BASE_TEXEL_DEG * KM_PER_DEG;
export const REGIONAL_LABEL = 'observed composite (NASA Blue Marble NG, 500 m)';

export const REGIONAL_POLICY = Object.freeze({
    activationDistance: 4.6, // scene units from the Earth centre (radius 2); beyond it nothing is requested
    fullWeightDistance: 4.3, // the blend reaches full weight below this distance
    minLevel: 4,
    debounceMs: 300,
    uploadsPerFrame: 2,
    fadeInMs: 400,
    tileTimeoutMs: Object.freeze([20_000, 30_000]),
    retries: 1,
    backoffMs: Object.freeze([1000]),
    grid: Object.freeze([32, 18]),
    // concurrency: requests in flight; slots: atlas side in tiles (fixed GPU memory); lruTiles: decoded tiles kept.
    desktop: Object.freeze({ maxLevel: 5, maxLevelHiDpi: 6, slots: 8, concurrency: 6, lruTiles: 32 }),
    touch: Object.freeze({ maxLevel: 5, maxLevelHiDpi: 5, slots: 4, concurrency: 4, lruTiles: 8 }),
});

/** Tile span (deg) and texel (km) of a level of the 500m set. */
export function regionalLevelGeometry(level) {
    const { columns, rows, tileSpanDeg } = tileGridDimensions(REGIONAL_LAYER.matrixSet, level);
    return { columns, rows, tileSpanDeg, texelKm: tileSpanDeg / GIBS_TILE_SIZE * KM_PER_DEG };
}

/** log2(z3 texel / level texel): the mip level at which the level is no sharper than z3. */
export function regionalBaseLod(level) {
    return Math.log2(REGIONAL_BASE_TEXEL_DEG / (regionalLevelGeometry(level).tileSpanDeg / GIBS_TILE_SIZE));
}

/** Device profile: touch (coarse pointer) or desktop; the level cap depends on the pixel ratio. */
export function regionalProfile({ touch = false, pixelRatio = 1, policy = REGIONAL_POLICY } = {}) {
    const base = touch ? policy.touch : policy.desktop;
    return { ...base, touch, pixelRatio, maxLevel: pixelRatio >= 2 ? base.maxLevelHiDpi : base.maxLevel };
}

/** The coarsest level whose texel is <= the footprint (km), capped; null when z3 is already fine enough. */
export function regionalLevelFor(footprintKm, maxLevel, minLevel = REGIONAL_POLICY.minLevel) {
    if (!(footprintKm < REGIONAL_BASE_TEXEL_KM)) return null;
    for (let level = minLevel; level <= maxLevel; level++) if (regionalLevelGeometry(level).texelKm <= footprintKm) return level;
    return maxLevel;
}

const wrap = (value, n) => ((value % n) + n) % n;

/** Slot of tile (x, y) in an S x S atlas for a window starting at column x0 (columns wrap at the antimeridian). */
export function regionalSlot(window, x, y, slots) {
    const ux = window.x0 + wrap(x - window.x0, window.columns);
    return { sx: wrap(ux, slots), sy: wrap(y, slots) };
}

export function regionalTileKey(level, x, y) {
    return `${level}/${x}/${y}`;
}

/**
 * Which tiles the view needs (pure). Vectors are [x, y, z] in the Earth mesh frame (radius `earthRadius`):
 * camera position, unit forward / right / up. Returns { active: false, reason } or
 * { active: true, level, window: { x0, y0, w, h, columns, rows }, tiles: [{ x, y, key, priority }], ... }.
 */
export function selectRegionalView({
    camera, forward, right, up, fovDeg, aspect, heightPx, pixelRatio = 1, maxLevel, slots,
    earthRadius = 2, kmPerUnit = 3185.5, policy = REGIONAL_POLICY,
}) {
    const distance = Math.hypot(...camera);
    if (!(distance < policy.activationDistance)) return { active: false, reason: 'distance', distance };
    const tanY = Math.tan(fovDeg * Math.PI / 360);
    const tanX = tanY * aspect;
    const pixelAngle = 2 * tanY / (heightPx * pixelRatio);
    const [gx, gy] = policy.grid;
    const c = camera[0] * camera[0] + camera[1] * camera[1] + camera[2] * camera[2] - earthRadius * earthRadius;
    const hits = [];
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
        const nx = (i + 0.5) / gx * 2 - 1;
        const ny = (j + 0.5) / gy * 2 - 1;
        const d = [0, 1, 2].map((k) => forward[k] + right[k] * nx * tanX + up[k] * ny * tanY);
        const len = Math.hypot(...d);
        const dir = d.map((v) => v / len);
        const b = camera[0] * dir[0] + camera[1] * dir[1] + camera[2] * dir[2];
        const disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (!(t > 0)) continue;
        const n = [0, 1, 2].map((k) => (camera[k] + t * dir[k]) / earthRadius);
        const cosI = Math.max(0.05, -(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]));
        const footprintKm = t * kmPerUnit * pixelAngle * len / cosI; // len: the off-axis pixel is larger
        // three.js SphereGeometry: x = -cos(phi) sin(theta), y = cos(theta), z = sin(phi) sin(theta); u = phi / 2pi.
        const lat = Math.asin(Math.max(-1, Math.min(1, n[1]))) * 180 / Math.PI;
        const lon = wrap(Math.atan2(n[2], -n[0]), 2 * Math.PI) / (2 * Math.PI) * 360 - 180;
        hits.push({ lat, lon, footprintKm, screen: Math.hypot(nx, ny) });
    }
    if (!hits.length) return { active: false, reason: 'no-surface', distance };
    const finest = hits.reduce((a, b) => (b.footprintKm < a.footprintKm ? b : a));
    const level = regionalLevelFor(finest.footprintKm, maxLevel, policy.minLevel);
    if (level === null) return { active: false, reason: 'base-sufficient', distance, footprintKm: finest.footprintKm };
    const { columns, rows, tileSpanDeg } = regionalLevelGeometry(level);
    const tileOf = (h) => ({ x: Math.min(columns - 1, Math.floor((h.lon + 180) / tileSpanDeg)), y: Math.min(rows - 1, Math.floor((90 - h.lat) / tileSpanDeg)) });
    const centre = tileOf(finest);
    const half = (n) => wrap(n + columns / 2, columns) - columns / 2; // signed column offset in [-cols/2, cols/2)
    const wanted = new Map();
    for (const h of hits) {
        if (!(h.footprintKm < REGIONAL_BASE_TEXEL_KM)) continue; // z3 is enough there
        const { x, y } = tileOf(h);
        const key = regionalTileKey(level, x, y);
        const entry = wanted.get(key);
        if (!entry) wanted.set(key, { x, y, dx: half(x - centre.x), dy: y - centre.y, screen: h.screen });
        else entry.screen = Math.min(entry.screen, h.screen);
    }
    const back = Math.floor((slots - 1) / 2);
    const list = [...wanted.values()];
    const xs = list.map((t) => t.dx);
    const ys = list.map((t) => t.dy);
    const xMin = Math.max(Math.min(...xs), -back);
    const xMax = Math.min(Math.max(...xs), xMin + slots - 1);
    const yMin = Math.max(Math.min(...ys), -back);
    const yMax = Math.min(Math.max(...ys), yMin + slots - 1);
    const window = { x0: wrap(centre.x + xMin, columns), y0: centre.y + yMin, w: xMax - xMin + 1, h: yMax - yMin + 1, columns, rows };
    const tiles = list
        .filter((t) => t.dx >= xMin && t.dx <= xMax && t.dy >= yMin && t.dy <= yMax)
        .sort((a, b) => a.screen - b.screen || a.y - b.y || a.x - b.x)
        .map((t, index) => ({ x: t.x, y: t.y, key: regionalTileKey(level, t.x, t.y), priority: index }));
    return { active: true, level, window, tiles, distance, footprintKm: finest.footprintKm };
}

export function regionalWindowKey(selection) {
    if (!selection?.active) return null;
    const { level, window: w } = selection;
    return `${level}:${w.x0},${w.y0},${w.w}x${w.h}`;
}

/** Suffix of the #surfaceStatus line ('' when the layer is off). */
export function describeRegionalStatus(status) {
    if (!status || status.state === 'off') return '';
    const z = `regional detail z${status.level}`;
    if (status.state === 'unavailable') return ` · ${z} unavailable (${status.failed} tiles failed) — z3 shown`;
    if (status.state === 'partial') return ` · ${z}: ${status.failed} of ${status.wanted} tiles unavailable — z3 shown there; ${REGIONAL_LABEL}`;
    if (status.state === 'loading') return ` · ${z} loading (${status.resident}/${status.wanted} tiles); ${REGIONAL_LABEL}`;
    return ` · ${z} (${status.resident}/${status.wanted} tiles); ${REGIONAL_LABEL}`;
}

/** GLSL: declarations (fragment <common>) and the blend (after <map_fragment>). */
export const REGIONAL_FRAGMENT_PARS = `
        uniform float uRegionalOnTw;
        uniform float uRegionalFadeTw;
        uniform float uRegionalBaseLodTw;
        uniform sampler2D uRegionalAtlasTw;
        uniform sampler2D uRegionalTableTw;
        uniform vec4 uRegionalGridTw;   // tile span (deg), columns at the level, slots per side, level
        uniform vec4 uRegionalWindowTw; // first column (wraps), first row, width, height (tiles)`;
export const REGIONAL_FRAGMENT_BODY = `
        if (uRegionalOnTw > 0.5) {
            // LOT 41: regional Blue Marble NG tiles (same product as the z3 map) where they are sharper.
            vec2 regTileTw = vec2(vMapUv.x * 360.0, (1.0 - vMapUv.y) * 180.0) / uRegionalGridTw.x;
            vec2 regTexelTw = regTileTw * 512.0;
            vec2 regDxTw = dFdx(regTexelTw);
            vec2 regDyTw = dFdy(regTexelTw);
            float regLodTw = 0.5 * log2(max(max(dot(regDxTw, regDxTw), dot(regDyTw, regDyTw)), 1e-8));
            vec2 regCellTw = floor(regTileTw);
            vec2 regFracTw = regTileTw - regCellTw;
            float regUxTw = uRegionalWindowTw.x + mod(regCellTw.x - uRegionalWindowTw.x, uRegionalGridTw.y);
            vec2 regLocalTw = vec2(regUxTw, regCellTw.y) - uRegionalWindowTw.xy;
            float regInsideTw = step(0.0, regLocalTw.x) * step(0.0, regLocalTw.y)
                * step(regLocalTw.x, uRegionalWindowTw.z - 1.0) * step(regLocalTw.y, uRegionalWindowTw.w - 1.0);
            vec2 regSlotTw = mod(vec2(regUxTw, regCellTw.y), uRegionalGridTw.z);
            vec4 regEntryTw = texelFetch(uRegionalTableTw, ivec2(regSlotTw), 0) * 255.0;
            float regMatchTw = step(abs(regEntryTw.r - regCellTw.x), 0.5) * step(abs(regEntryTw.g - regCellTw.y), 0.5)
                * step(abs(regEntryTw.b - uRegionalGridTw.w), 0.5);
            float regLodSTw = clamp(regLodTw, 0.0, uRegionalBaseLodTw);
            float regInsetTw = 0.5 * exp2(ceil(regLodSTw));
            vec2 regInTileTw = clamp(regFracTw * 512.0, vec2(regInsetTw), vec2(512.0 - regInsetTw));
            vec3 regColorTw = textureLod(uRegionalAtlasTw, (regSlotTw * 512.0 + regInTileTw) / (uRegionalGridTw.z * 512.0), regLodSTw).rgb;
            vec2 regInWindowTw = regLocalTw + regFracTw;
            float regEdgeTw = min(min(regInWindowTw.x, uRegionalWindowTw.z - regInWindowTw.x), min(regInWindowTw.y, uRegionalWindowTw.w - regInWindowTw.y));
            float regWeightTw = regInsideTw * regMatchTw * (regEntryTw.a / 255.0) * smoothstep(0.0, 0.35, regEdgeTw)
                * (1.0 - smoothstep(uRegionalBaseLodTw - 1.0, uRegionalBaseLodTw, regLodTw)) * uRegionalFadeTw;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * regColorTw, regWeightTw);
        }`;

/** Adds the regional blend to an Earth material shader (Phong or PBR); call after the other injections. */
export function injectRegionalSurface(shader, regional) {
    if (!regional?.uniforms) return;
    Object.assign(shader.uniforms, regional.uniforms);
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${REGIONAL_FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>${REGIONAL_FRAGMENT_BODY}`);
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The runtime of the layer. update(camera, earthMesh) once per frame (selection, debounce, uploads, fades);
 * bindRenderer(renderer) from the mesh's onBeforeRender (the atlas lives in the page renderer only: an export
 * renderer draws z3). Owned: requests (AbortControllers under `signal`), LRU bitmaps, GPU textures; dispose().
 */
export function createRegionalSurface({
    THREE,
    renderer,
    touch = false,
    pixelRatio = () => renderer.getPixelRatio?.() ?? 1,
    loadImage = loadGibsTileBitmap,
    signal = null,
    now = () => performance.now(),
    policy = REGIONAL_POLICY,
    onStatus = null,
}) {
    let profile = regionalProfile({ touch, pixelRatio: pixelRatio(), policy });
    const slots = profile.slots;
    const atlasSize = slots * GIBS_TILE_SIZE;
    const limiter = createPriorityLimiter(profile.concurrency);
    const lru = new LruTileCache(profile.lruTiles);
    const tableData = new Uint8Array(slots * slots * 4);
    const table = new THREE.DataTexture(tableData, slots, slots, THREE.RGBAFormat, THREE.UnsignedByteType);
    table.magFilter = THREE.NearestFilter;
    table.minFilter = THREE.NearestFilter;
    table.generateMipmaps = false;
    table.needsUpdate = true;
    const placeholder = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    placeholder.needsUpdate = true;
    let atlas = null; // allocated on first use
    const uniforms = {
        uRegionalOnTw: { value: 0 },
        uRegionalFadeTw: { value: 0 },
        uRegionalBaseLodTw: { value: 0 },
        uRegionalAtlasTw: { value: placeholder },
        uRegionalTableTw: { value: table },
        uRegionalGridTw: { value: new THREE.Vector4(0, 1, slots, 0) },
        uRegionalWindowTw: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    const slotState = Array.from({ length: slots * slots }, () => ({ key: null, fadeStart: 0, fading: false }));
    const inflight = new Map(); // key -> AbortController
    const failing = new Set();
    let uploads = []; // { key, level, x, y, bitmap }
    let current = null; // applied selection
    let pending = null; // { key, since, selection }
    let enabled = false; // the page renderer may draw the layer
    let disposed = false;
    let lastStatusText = null;
    const stats = { requested: 0, arrived: 0, failed: 0, aborted: 0, cacheHits: 0, uploaded: 0, maxInflight: 0, maxActiveRequests: 0 };
    const v = new THREE.Vector3();
    const inv = new THREE.Matrix4();

    function ensureAtlas() {
        if (atlas) return atlas;
        atlas = new THREE.DataTexture(null, atlasSize, atlasSize, THREE.RGBAFormat, THREE.UnsignedByteType);
        atlas.source.dataReady = false; // storage only (texStorage2D); tiles are copied in
        atlas.colorSpace = THREE.SRGBColorSpace; // as the z3 map: sampled linear
        atlas.generateMipmaps = true;
        atlas.minFilter = THREE.LinearMipmapLinearFilter;
        atlas.magFilter = THREE.LinearFilter;
        atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
        atlas.flipY = false; // row 0 = the north edge of a tile
        // The full mip chain declared explicitly, without data: texStorage2D allocates every level (it is immutable,
        // so an allocation made while generateMipmaps is off would hold one level only) and nothing is generated
        // on the empty texture. three.js then turns generateMipmaps off; flushUploads switches it on for the last
        // copy of each frame, so copyTextureToTexture rebuilds the chain once per frame.
        for (let size = atlasSize; size >= 1; size >>= 1) atlas.mipmaps.push({ data: null, width: size, height: size });
        atlas.needsUpdate = true;
        renderer.initTexture?.(atlas);
        uniforms.uRegionalAtlasTw.value = atlas;
        return atlas;
    }

    function wantedKeys() {
        return new Set(current?.tiles.map((t) => t.key) || []);
    }

    function abortWhere(test) {
        for (const [key, controller] of inflight) {
            if (test(key)) controller.abort(new DOMException('regional tile no longer needed', 'AbortError'));
        }
        uploads = uploads.filter((u) => !test(u.key));
    }

    function slotIndexFor(tile) {
        const { sx, sy } = regionalSlot(current.window, tile.x, tile.y, slots);
        return sy * slots + sx;
    }

    function request(tile, level) {
        if (inflight.has(tile.key) || signal?.aborted) return;
        const controller = new AbortController();
        const onOuter = () => controller.abort(signal.reason);
        signal?.addEventListener('abort', onOuter, { once: true });
        inflight.set(tile.key, controller);
        stats.maxInflight = Math.max(stats.maxInflight, inflight.size);
        stats.requested++;
        const url = gibsTileUrl(REGIONAL_LAYER, null, level, tile.x, tile.y);
        limiter.run(-tile.priority, () => {
            stats.maxActiveRequests = Math.max(stats.maxActiveRequests, limiter.active); // <= concurrency
            return loadTileWithRetry(loadImage, url, {
                timeoutMs: policy.tileTimeoutMs, retries: policy.retries, backoffMs: policy.backoffMs, signal: controller.signal,
            });
        })
            .then((bitmap) => {
                if (disposed || controller.signal.aborted) { bitmap?.close?.(); return; }
                stats.arrived++;
                failing.delete(tile.key);
                lru.set(tile.key, { bitmap, dispose: () => bitmap?.close?.() });
                if (wantedKeys().has(tile.key)) uploads.push({ key: tile.key, level, x: tile.x, y: tile.y, bitmap });
            })
            .catch((error) => {
                if (controller.signal.aborted || error?.name === 'AbortError') { stats.aborted++; return; }
                stats.failed++;
                failing.add(tile.key);
            })
            .finally(() => {
                if (inflight.get(tile.key) === controller) inflight.delete(tile.key);
                signal?.removeEventListener('abort', onOuter);
            });
    }

    function apply(selection) {
        current = selection;
        const { level, window } = selection;
        const { tileSpanDeg } = regionalLevelGeometry(level);
        uniforms.uRegionalGridTw.value.set(tileSpanDeg, window.columns, slots, level);
        uniforms.uRegionalWindowTw.value.set(window.x0, window.y0, window.w, window.h);
        uniforms.uRegionalBaseLodTw.value = regionalBaseLod(level);
        const keep = wantedKeys();
        abortWhere((key) => !keep.has(key));
        for (const tile of selection.tiles) {
            if (slotState[slotIndexFor(tile)].key === tile.key) continue; // already on the GPU
            if (uploads.some((u) => u.key === tile.key)) continue;
            const cached = lru.get(tile.key);
            if (cached) { stats.cacheHits++; uploads.push({ key: tile.key, level, x: tile.x, y: tile.y, bitmap: cached.bitmap }); continue; }
            request(tile, level);
        }
        uploads.sort((a, b) => priorityOf(a.key) - priorityOf(b.key));
    }

    function priorityOf(key) {
        return current?.tiles.find((t) => t.key === key)?.priority ?? Infinity;
    }

    function flushUploads(t) {
        if (!uploads.length || !current) return;
        const wanted = wantedKeys();
        // A bitmap closed by the LRU while queued (width 0) is requested again; a tile no longer wanted is dropped.
        uploads = uploads.filter((u) => {
            if (!wanted.has(u.key)) return false;
            if (u.bitmap?.width > 0) return true;
            const tile = current.tiles.find((x) => x.key === u.key);
            if (tile) request(tile, u.level);
            return false;
        });
        const batch = uploads.splice(0, policy.uploadsPerFrame);
        if (!batch.length) return;
        const target = ensureAtlas();
        batch.forEach((u, i) => {
            const slot = slotIndexFor(u);
            const source = new THREE.Texture(u.bitmap);
            target.generateMipmaps = i === batch.length - 1; // one mip rebuild per frame
            renderer.copyTextureToTexture(source, target, null, { x: (slot % slots) * GIBS_TILE_SIZE, y: Math.floor(slot / slots) * GIBS_TILE_SIZE, z: 0 });
            target.generateMipmaps = false;
            slotState[slot] = { key: u.key, fadeStart: t, fading: true };
            tableData.set([u.x, u.y, u.level, 0], slot * 4);
            stats.uploaded++;
        });
        table.needsUpdate = true;
    }

    function updateFades(t) {
        let changed = false;
        slotState.forEach((s, slot) => {
            if (!s.fading) return;
            const f = Math.min(1, (t - s.fadeStart) / policy.fadeInMs);
            tableData[slot * 4 + 3] = Math.round(f * 255);
            if (f >= 1) s.fading = false;
            changed = true;
        });
        if (changed) table.needsUpdate = true;
    }

    function status() {
        if (!current || !enabled) return { state: 'off', level: current?.level ?? null, wanted: 0, resident: 0, failed: 0, inflight: inflight.size };
        const wanted = current.tiles.length;
        const resident = current.tiles.filter((tile) => slotState[slotIndexFor(tile)].key === tile.key).length;
        const failed = current.tiles.filter((tile) => failing.has(tile.key)).length;
        const state = resident === wanted ? 'active' : failed && !resident ? 'unavailable' : failed ? 'partial' : 'loading';
        return { state, level: current.level, wanted, resident, failed, inflight: inflight.size };
    }

    function publishStatus() {
        const s = status();
        const text = `${s.state}|${describeRegionalStatus(s)}`;
        if (text === lastStatusText) return;
        lastStatusText = text;
        onStatus?.(s);
    }

    function update(camera, earthMesh) {
        if (disposed) return;
        const t = now();
        profile = regionalProfile({ touch, pixelRatio: pixelRatio(), policy });
        earthMesh.updateMatrixWorld();
        inv.copy(earthMesh.matrixWorld).invert();
        const cam = v.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv).toArray();
        const axis = (column) => v.setFromMatrixColumn(camera.matrixWorld, column).transformDirection(inv).toArray();
        const right = axis(0);
        const up = axis(1);
        const forward = axis(2).map((c) => -c);
        const height = renderer.domElement?.clientHeight || renderer.domElement?.height || 1;
        const selection = selectRegionalView({
            camera: cam, forward, right, up, fovDeg: camera.fov, aspect: camera.aspect, heightPx: height,
            pixelRatio: profile.pixelRatio, maxLevel: profile.maxLevel, slots, policy,
        });
        const distance = selection.distance;
        uniforms.uRegionalFadeTw.value = 1 - smoothstep(policy.fullWeightDistance, policy.activationDistance, distance);
        if (!selection.active) {
            if (selection.reason === 'distance') {
                enabled = false; // nothing drawn, nothing requested
                pending = null;
                if (inflight.size || uploads.length) abortWhere(() => true);
            }
            publishStatus();
            return;
        }
        enabled = true;
        // Allocated while the window is still debounced, so the allocation and the first upload are separate frames.
        ensureAtlas();
        const key = regionalWindowKey(selection);
        if (key !== regionalWindowKey(current)) {
            if (pending?.key !== key) pending = { key, since: t, selection };
            else if (t - pending.since >= policy.debounceMs) { apply(selection); pending = null; }
        } else {
            pending = null;
        }
        flushUploads(t);
        updateFades(t);
        publishStatus();
    }

    /** From the Earth mesh's onBeforeRender: the layer is drawn only by the page renderer. */
    function bindRenderer(activeRenderer) {
        uniforms.uRegionalOnTw.value = enabled && current && activeRenderer === renderer && uniforms.uRegionalFadeTw.value > 0 ? 1 : 0;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        enabled = false;
        abortWhere(() => true);
        lru.clear();
        uploads = [];
        uniforms.uRegionalOnTw.value = 0;
        atlas?.dispose();
        table.dispose();
        placeholder.dispose();
    }

    return {
        uniforms,
        update,
        bindRenderer,
        dispose,
        getStatus: status,
        getDebugState: () => ({
            current: current && { level: current.level, window: { ...current.window }, tiles: current.tiles.length },
            pending: pending?.key || null,
            inflight: inflight.size, // requested and not settled (waiting for a request slot or on the network)
            activeRequests: limiter.active, // on the network now (<= profile.concurrency)
            queuedUploads: uploads.length,
            slots,
            atlasSize,
            atlasAllocated: Boolean(atlas),
            atlasBytes: atlas ? Math.round(atlasSize * atlasSize * 4 * 4 / 3) : 0,
            profile: { ...profile },
            stats: { ...stats },
            enabled,
            on: uniforms.uRegionalOnTw.value,
            fade: uniforms.uRegionalFadeTw.value,
        }),
    };
}
