// Living Himalaya LOT 2: overview terrain from Terrarium tiles (AWS Terrain
// Tiles), zoom 6 / 8 / 9 chosen per tile from the camera distance, only the
// tiles inside the view frustum and the 26-46°N / 67-103°E region.
// Ownership: one AbortController per overview (dispose aborts every request);
// at most MAX_CONCURRENT requests in flight; decoded tiles live in an LRU of
// LRU_CAPACITY entries whose eviction disposes the GPU geometry.
// Lighting only (no cast shadows); the area under a visible GLO-30 patch is
// discarded in the fragment shader (clip quad).
import * as THREE from 'three';
import { projectLonLat, heightKm } from './projection.js';
import {
  TERRARIUM_ZOOMS, childTiles, createLru, decodeTerrarium, regionTiles, terrariumUrl,
  tileBounds, tileKey, tileXToLon, tileYToLat, TILE_SIZE,
} from './terrarium.js';

export const MAX_CONCURRENT = 6;
export const LRU_CAPACITY = 150;
const SEGMENTS = 64;
const REFINE_FACTOR = Object.freeze({ 6: 1.25, 8: 1.0 });
const SKIRT_KM = Object.freeze({ 6: 3, 8: 1.5, 9: 1 });

/** Installs the "discard inside the patch quad" clip on a standard material. */
export function installClip(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uClipQuad = uniforms.uClipQuad;
    shader.uniforms.uClipOn = uniforms.uClipOn;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vClipXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvClipXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vClipXZ;
uniform vec2 uClipQuad[4];
uniform float uClipOn;
float clipEdge(vec2 a, vec2 b, vec2 p) { return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); }`)
      .replace('void main() {', `void main() {
  if (uClipOn > 0.5) {
    float e0 = clipEdge(uClipQuad[0], uClipQuad[1], vClipXZ);
    float e1 = clipEdge(uClipQuad[1], uClipQuad[2], vClipXZ);
    float e2 = clipEdge(uClipQuad[2], uClipQuad[3], vClipXZ);
    float e3 = clipEdge(uClipQuad[3], uClipQuad[0], vClipXZ);
    if ((e0 > 0.0 && e1 > 0.0 && e2 > 0.0 && e3 > 0.0) || (e0 < 0.0 && e1 < 0.0 && e2 < 0.0 && e3 < 0.0)) discard;
  }`);
  };
  material.customProgramCacheKey = () => 'himalaya-clip';
}

/** Blob -> heights via createImageBitmap with no colour conversion. */
export async function decodeTerrariumBlob(blob) {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return decodeTerrarium(context.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}

function sampleBilinear(heights, u, v) {
  const x = Math.min(TILE_SIZE - 1, Math.max(0, u));
  const y = Math.min(TILE_SIZE - 1, Math.max(0, v));
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const x1 = Math.min(TILE_SIZE - 1, x0 + 1); const y1 = Math.min(TILE_SIZE - 1, y0 + 1);
  const fx = x - x0; const fy = y - y0;
  const h00 = heights[y0 * TILE_SIZE + x0]; const h10 = heights[y0 * TILE_SIZE + x1];
  const h01 = heights[y1 * TILE_SIZE + x0]; const h11 = heights[y1 * TILE_SIZE + x1];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
}

function buildTileGeometry(tile, heights, center) {
  const n = SEGMENTS + 1;
  const border = 4 * SEGMENTS;
  const positions = new Float32Array((n * n + border) * 3);
  for (let j = 0; j < n; j++) {
    const v = (j / SEGMENTS) * TILE_SIZE;
    const lat = tileYToLat(tile.y + v / TILE_SIZE, tile.z);
    for (let i = 0; i < n; i++) {
      const u = (i / SEGMENTS) * TILE_SIZE;
      const lon = tileXToLon(tile.x + u / TILE_SIZE, tile.z);
      const p = projectLonLat(lon, lat, center);
      const h = Math.max(0, sampleBilinear(heights, u - 0.5, v - 0.5)); // sea floor drawn at 0 m
      const o = (j * n + i) * 3;
      positions[o] = p.x; positions[o + 1] = heightKm(h); positions[o + 2] = p.z;
    }
  }
  const indices = [];
  for (let j = 0; j < SEGMENTS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * n + i; const b = a + 1; const c = a + n; const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Skirt: border loop N (W->E), E (N->S), S (E->W), W (S->N), dropped by SKIRT_KM.
  const loop = [];
  for (let i = 0; i < SEGMENTS; i++) loop.push(i);
  for (let j = 0; j < SEGMENTS; j++) loop.push(j * n + SEGMENTS);
  for (let i = SEGMENTS; i > 0; i--) loop.push(SEGMENTS * n + i);
  for (let j = SEGMENTS; j > 0; j--) loop.push(j * n);
  const base = n * n;
  loop.forEach((vertex, k) => {
    const o = (base + k) * 3;
    positions[o] = positions[vertex * 3];
    positions[o + 1] = positions[vertex * 3 + 1] - SKIRT_KM[tile.z];
    positions[o + 2] = positions[vertex * 3 + 2];
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Normals from the surface grid only; skirt vertices copy their border normal.
  geometry.setIndex(indices.slice());
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  loop.forEach((vertex, k) => normals.setXYZ(base + k, normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex)));
  for (let k = 0; k < loop.length; k++) {
    const A = loop[k]; const B = loop[(k + 1) % loop.length];
    const A2 = base + k; const B2 = base + ((k + 1) % loop.length);
    indices.push(A, B, A2, B, B2, A2, A, A2, B, B, A2, B2); // both windings: visible from either side
  }
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {THREE.Camera} o.camera
 * @param {{lat:number, lon:number}} o.center
 * @param {(url:string, key:string, signal:AbortSignal)=>Promise<Blob>} o.fetchTile
 * @param {THREE.Material} o.material
 * @param {(tile, heights:Float32Array)=>void} [o.onTileDecoded]
 * @param {()=>void} [o.onChange]
 */
export function createTerrainOverview({ scene, camera, center, fetchTile, material, onTileDecoded = () => {}, onChange = () => {} }) {
  const controller = new AbortController();
  const group = new THREE.Group();
  group.name = 'himalaya-overview-terrain';
  scene.add(group);
  const info = new Map(); // key -> {center: Vector3, radius}
  const drawn = new Set();
  const stats = { requested: 0, loaded: 0, failed: 0, evicted: 0, aborted: 0 };
  const failed = new Set();
  const inflight = new Map();
  let queue = [];
  let disposed = false;
  let updates = 0;

  const lru = createLru(LRU_CAPACITY, (key, entry) => {
    group.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    stats.evicted += 1;
  });

  function tileInfo(tile) {
    const key = tileKey(tile.z, tile.x, tile.y);
    if (!info.has(key)) {
      const b = tileBounds(tile);
      const corners = [[b.lonMin, b.latMin], [b.lonMax, b.latMin], [b.lonMin, b.latMax], [b.lonMax, b.latMax]].map(([lo, la]) => projectLonLat(lo, la, center));
      const cx = corners.reduce((s, p) => s + p.x, 0) / 4;
      const cz = corners.reduce((s, p) => s + p.z, 0) / 4;
      const radius = Math.max(...corners.map((p) => Math.hypot(p.x - cx, p.z - cz)));
      const box = new THREE.Box3(
        new THREE.Vector3(Math.min(...corners.map((p) => p.x)), -1, Math.min(...corners.map((p) => p.z))),
        new THREE.Vector3(Math.max(...corners.map((p) => p.x)), 9, Math.max(...corners.map((p) => p.z))),
      );
      info.set(key, { key, center: new THREE.Vector3(cx, 3, cz), radius, box, size: radius * 2 / Math.SQRT2 });
    }
    return info.get(key);
  }

  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const desired = new Map(); // key -> {tile, priority}

  function want(tile, distance) {
    const key = tileKey(tile.z, tile.x, tile.y);
    if (lru.has(key) || inflight.has(key) || failed.has(key)) return;
    const prev = desired.get(key);
    if (!prev || distance < prev.distance) desired.set(key, { tile, key, distance });
  }

  function select(tile, out) {
    const t = tileInfo(tile);
    if (!frustum.intersectsBox(t.box)) return;
    const distance = Math.max(0, camera.position.distanceTo(t.center) - t.radius);
    const loaded = lru.has(t.key);
    const factor = REFINE_FACTOR[tile.z];
    if (factor && distance < t.size * factor) {
      const kids = childTiles(tile).filter((k) => frustum.intersectsBox(tileInfo(k).box));
      // A failed child keeps its parent drawn (no hole); failed tiles are not retried.
      const ready = kids.length > 0 && kids.every((k) => lru.has(tileKey(k.z, k.x, k.y)));
      if (ready) {
        kids.forEach((k) => select(k, out));
        if (!loaded) want(tile, distance);
        return;
      }
      kids.forEach((k) => want(k, Math.max(0, camera.position.distanceTo(tileInfo(k).center) - tileInfo(k).radius)));
    }
    if (loaded) out.push(t.key);
    else want(tile, distance);
  }

  async function load(entry) {
    const { tile, key } = entry;
    const url = terrariumUrl(tile.z, tile.x, tile.y);
    const requestController = new AbortController();
    const onAbort = () => requestController.abort(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    inflight.set(key, requestController);
    stats.requested += 1;
    try {
      const blob = await fetchTile(url, `terrarium:${key}`, requestController.signal);
      if (disposed) return;
      const heights = await decodeTerrariumBlob(blob);
      if (disposed) return;
      onTileDecoded(tile, heights);
      const mesh = new THREE.Mesh(buildTileGeometry(tile, heights, center), material);
      mesh.name = `terrarium-${key}`;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      mesh.renderOrder = -1;
      group.add(mesh);
      lru.set(key, { tile, mesh }, { isPinned: (k) => drawn.has(k) });
      stats.loaded += 1;
    } catch (error) {
      if (disposed || requestController.signal.aborted) { stats.aborted += 1; return; }
      failed.add(key);
      stats.failed += 1;
      console.warn(`[Living Himalaya] Terrarium tile ${key} unavailable.`, error?.message || error);
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
      inflight.delete(key);
      if (!disposed) { pump(); onChange(); }
    }
  }

  function pump() {
    while (!disposed && inflight.size < MAX_CONCURRENT && queue.length) {
      const next = queue.shift();
      if (lru.has(next.key) || inflight.has(next.key)) continue;
      load(next);
    }
  }

  const roots = regionTiles(TERRARIUM_ZOOMS[0]);
  function update() {
    if (disposed) return;
    updates += 1;
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    desired.clear();
    const out = [];
    roots.forEach((tile) => select(tile, out));
    drawn.clear();
    out.forEach((key) => drawn.add(key));
    for (const key of lru.keys()) lru.peek(key).mesh.visible = drawn.has(key);
    out.forEach((key) => lru.get(key));
    queue = [...desired.values()].sort((a, b) => (a.tile.z - b.tile.z) || (a.distance - b.distance));
    pump();
  }

  return Object.freeze({
    group,
    update,
    stats: () => ({ ...stats, inLru: lru.size, drawn: drawn.size, inflight: inflight.size, queued: queue.length,
      drawnByZoom: [...drawn].reduce((acc, key) => { const z = key.split('/')[0]; acc[z] = (acc[z] || 0) + 1; return acc; }, {}) }),
    /** True while no queued/in-flight work remains for the current view. */
    idle: () => updates > 0 && inflight.size === 0 && queue.length === 0,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort(new DOMException('Living Himalaya overview disposed', 'AbortError'));
      queue = [];
      lru.clear();
      scene.remove(group);
    },
  });
}
