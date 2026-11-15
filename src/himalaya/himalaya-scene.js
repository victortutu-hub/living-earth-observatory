// Living Himalaya LOT 2: WebGL2 scene with real terrain, mode "Lit terrain"
// (uniform albedo, no draped imagery; lit by the real Sun).
//   * Overview: Terrarium tiles z6 / z8 / z9 (terrain-overview.js), shading only.
//   * Detail: the Copernicus GLO-30 patch of the focused summit
//     (terrain-patch.js), 2048² shadow map recomputed only when the Sun, the
//     patch or its LOD changes (shadowMap.autoUpdate = false).
//   * Summit markers at the official elevation, labels (CSS2D), OrbitControls.
// Projection: azimuthal equidistant (projection.js); 1 unit = 1 km; vertical
// exaggeration 1.0 everywhere. Async work (tiles, patches, decoder) is owned
// by the scene and cancelled/ignored after dispose.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { projectLonLat, unprojectXZ, heightKm, localBasis, VERTICAL_EXAGGERATION } from './projection.js';
import { utmForward } from './utm.js';
import { createTerrainOverview, installClip } from './terrain-overview.js';
import { buildPatchGeometry, decodePatch, patchCornersXZ, FULL_LOD_DISTANCE_KM } from './terrain-patch.js';
import { sunDirectionScene } from './sun-position.js';
import { moonlightIntensity } from './moon-position.js';
import { createLru, lonToTileX, latToTileY, OVERVIEW_REGION, TILE_SIZE } from './terrarium.js';

export { projectLonLat, VERTICAL_EXAGGERATION };
export const FLY_DURATION_MS = 1200;
export const PATCH_FADE_MS = 400;
export const SHADOW_MAP_SIZE = 2048;
export const MAX_PATCHES_IN_MEMORY = 2;
const TERRAIN_ALBEDO = 0xc3ccd3;
const SHADOW_HALF_KM = 16;
const OVERVIEW_VIEW = Object.freeze({ target: [0, 0, 120], position: [0, 2350, 2050] });

/** Marker height = official elevation (km), exaggeration 1.0. */
export function markerHeightKm(elevationM) {
  return heightKm(elevationM);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

let zstdPromise = null;
function loadZstd() {
  if (!zstdPromise) {
    zstdPromise = import('three/addons/libs/zstddec.module.js').then(async ({ ZSTDDecoder }) => {
      const decoder = new ZSTDDecoder();
      await decoder.init();
      return decoder;
    }).catch((error) => { zstdPromise = null; throw error; });
  }
  return zstdPromise;
}

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas
 * @param {HTMLElement} o.labelHost
 * @param {Array} o.peaks
 * @param {{lat:number, lon:number}} o.center
 * @param {(id:string)=>void} o.onSelect
 * @param {()=>boolean} o.reducedMotion
 * @param {(url:string, key:string, signal:AbortSignal)=>Promise<Blob>} o.fetchTile
 * @param {(url:string, key:string, signal:AbortSignal)=>Promise<ArrayBuffer>} o.fetchPatch
 * @param {(id:string)=>object|null} o.getPatchMeta
 * @param {(event:object)=>void} [o.onTerrainEvent]
 */
export function createHimalayaScene({
  canvas, labelHost, peaks, center, onSelect, reducedMotion,
  fetchTile, fetchPatch, getPatchMeta, onTerrainEvent = () => {},
}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    throw new Error('WebGL2 is not available.');
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x03060d, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'himalaya-label-layer';
  labelHost.append(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 30000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 1.5;
  controls.maxDistance = 6000;
  controls.screenSpacePanning = false;

  const disposables = [];
  const track = (resource) => { disposables.push(resource); return resource; };
  const disposeController = new AbortController();
  let disposed = false;

  // --- lights: the real Sun (directional) + a dim sky fill
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF_KM, right: SHADOW_HALF_KM, top: SHADOW_HALF_KM, bottom: -SHADOW_HALF_KM, near: 1, far: 260 });
  scene.add(sun, sun.target);
  const sky = new THREE.HemisphereLight(0x9cc7ff, 0x1a1c22, 0.32);
  scene.add(sky);
  let sunState = null;
  // The real Moon (Lot 3): cool directional light, no cast shadows,
  // brightness exaggerated for visibility (declared in the UI).
  const moonLight = new THREE.DirectionalLight(0xb8cdf5, 0);
  moonLight.castShadow = false;
  scene.add(moonLight, moonLight.target);
  let moonState = null;

  // --- terrain materials (shared clip uniforms)
  const clipUniforms = { uClipQuad: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] }, uClipOn: { value: 0 } };
  // Front faces only (DoubleSide z-fights along ridge silhouettes); the skirts
  // are emitted with both windings instead, so seams close from either side.
  const overviewMaterial = track(new THREE.MeshStandardMaterial({ color: TERRAIN_ALBEDO, roughness: 0.96, metalness: 0 }));
  installClip(overviewMaterial, clipUniforms);
  const patchMaterial = track(new THREE.MeshStandardMaterial({ color: TERRAIN_ALBEDO, roughness: 0.96, metalness: 0 }));

  // --- Terrarium summit samples (highest zoom wins), for the DEM row in Terrarium mode
  const terrariumSummits = new Map();
  function recordTerrariumSummits(tile, heights) {
    for (const peak of peaks) {
      const px = (lonToTileX(peak.lon, tile.z) - tile.x) * TILE_SIZE;
      const py = (latToTileY(peak.lat, tile.z) - tile.y) * TILE_SIZE;
      if (px < 0 || py < 0 || px >= TILE_SIZE || py >= TILE_SIZE) continue;
      const prev = terrariumSummits.get(peak.id);
      if (prev && prev.z >= tile.z) continue;
      let max = -Infinity;
      const cx = Math.floor(px); const cy = Math.floor(py);
      for (let y = Math.max(0, cy - 1); y <= Math.min(TILE_SIZE - 1, cy + 1); y++) {
        for (let x = Math.max(0, cx - 1); x <= Math.min(TILE_SIZE - 1, cx + 1); x++) max = Math.max(max, heights[y * TILE_SIZE + x]);
      }
      terrariumSummits.set(peak.id, { z: tile.z, valueM: max, window: '3x3 pixels around the summit' });
      onTerrainEvent({ type: 'terrarium-summit', peakId: peak.id, z: tile.z, valueM: max });
    }
  }

  const overview = createTerrainOverview({
    scene, camera, center, fetchTile, material: overviewMaterial,
    onTileDecoded: recordTerrariumSummits,
    onChange: () => { overviewDirty = true; },
  });
  let overviewDirty = true;

  // --- lat/lon graticule (drawn over the terrain, faded out near the ground)
  const gridPositions = [];
  const R = OVERVIEW_REGION;
  const pushSeg = (a, b) => gridPositions.push(a.x, 0, a.z, b.x, 0, b.z);
  for (let lat = R.latMin; lat <= R.latMax; lat += 2) {
    for (let lon = R.lonMin; lon < R.lonMax; lon += 0.5) pushSeg(projectLonLat(lon, lat, center), projectLonLat(lon + 0.5, lat, center));
  }
  for (let lon = R.lonMin + 1; lon <= R.lonMax; lon += 2) {
    for (let lat = R.latMin; lat < R.latMax; lat += 0.5) pushSeg(projectLonLat(lon, lat, center), projectLonLat(lon, lat + 0.5, center));
  }
  const gridGeometry = track(new THREE.BufferGeometry());
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
  const gridMaterial = track(new THREE.LineBasicMaterial({ color: 0x67c6e8, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false }));
  const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
  grid.renderOrder = 5;
  scene.add(grid);
  const gridLabels = [];
  const addGridLabel = (text, lon, lat) => {
    const element = document.createElement('span');
    element.className = 'himalaya-grid-label';
    element.textContent = text;
    const object = new CSS2DObject(element);
    const p = projectLonLat(lon, lat, center);
    object.position.set(p.x, 0, p.z);
    scene.add(object);
    gridLabels.push(object);
  };
  for (let lon = R.lonMin + 1; lon <= R.lonMax; lon += 4) addGridLabel(`${lon}°E`, lon, R.latMin - 0.4);
  for (let lat = R.latMin; lat <= R.latMax; lat += 4) addGridLabel(`${lat}°N`, R.lonMin - 0.9, lat);

  // --- markers: head at the official elevation, label above
  const headGeometry = track(new THREE.SphereGeometry(1, 16, 10));
  const headMaterial = track(new THREE.MeshBasicMaterial({ color: 0x9fe8ff, depthTest: false, transparent: true, opacity: 0.95 }));
  const activeMaterial = track(new THREE.MeshBasicMaterial({ color: 0xfde68a, depthTest: false, transparent: true, opacity: 0.95 }));
  const markers = new Map();
  for (const peak of peaks) {
    const p = projectLonLat(peak.lon, peak.lat, center);
    const top = new THREE.Vector3(p.x, markerHeightKm(peak.elevationM), p.z);
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.copy(top);
    head.renderOrder = 6;
    head.userData.peakId = peak.id;
    scene.add(head);
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'himalaya-peak-label';
    label.dataset.peakId = peak.id;
    label.textContent = `${peak.name} · ${peak.elevationM.toLocaleString('en-US')} m`;
    label.addEventListener('click', () => onSelect(peak.id));
    const labelObject = new CSS2DObject(label);
    labelObject.position.copy(top);
    scene.add(labelObject);
    markers.set(peak.id, { peak, head, label, labelObject, top });
  }

  // --- screen-space picking of marker heads (16 px)
  const projected = new THREE.Vector3();
  let downAt = null;
  const onPointerDown = (event) => { downAt = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) return;
    const rect = canvas.getBoundingClientRect();
    let best = null; let bestDistance = 16;
    for (const marker of markers.values()) {
      projected.copy(marker.top).project(camera);
      if (projected.z > 1) continue;
      const sx = rect.left + ((projected.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - projected.y) / 2) * rect.height;
      const d = Math.hypot(sx - event.clientX, sy - event.clientY);
      if (d < bestDistance) { bestDistance = d; best = marker.peak.id; }
    }
    if (best) onSelect(best);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);

  // --- GLO-30 patches (at most MAX_PATCHES_IN_MEMORY)
  let terrainMode = 'glo30';
  let activePatchId = null;
  const patchStates = new Map(); // id -> 'loading' | 'ready' | 'error'
  const patchErrors = new Map();
  const patches = createLru(MAX_PATCHES_IN_MEMORY, (id, entry) => {
    scene.remove(entry.mesh);
    entry.geometry.dispose();
    entry.fullIndex = null;
    entry.coarseIndex = null;
    patchStates.delete(id);
  });
  let fade = null;
  let shadowUpdates = 0;
  let shadowSkipped = 0;
  let lastShadowRequest = null;

  // --- Sentinel-2 "Satellite" mode (Lot 4): unlit draped image on the GLO-30
  // patch; no Sun, Moon or shadows on it (lighting as captured).
  let imageMode = 'lit';
  const satellite = new Map(); // peakId -> { texture, material, utm, uvKey, width, height, level }

  function satelliteFor(entry) {
    return entry && imageMode === 'satellite' ? satellite.get(entry.id) || null : null;
  }
  function materialFor(entry) {
    return satelliteFor(entry)?.material || patchMaterial;
  }
  /**
   * Per-vertex UV: grid lat/lon -> UTM (Krüger) -> image extent. UTM is
   * evaluated on every 8th row/column and interpolated bilinearly in between
   * (error far below 1 mm over 240 m); skirt vertices use their position.
   */
  function ensureUv(entry, sat) {
    if (entry.uvKey === sat.uvKey) return;
    const started = performance.now();
    const position = entry.geometry.getAttribute('position');
    const uv = new Float32Array(position.count * 2);
    const { zone, e0, n0, widthM, heightM } = sat.utm;
    const meta = getPatchMeta(entry.id);
    const { rows, cols } = meta;
    const step = 8;
    const rowsC = []; for (let j = 0; j < rows; j += step) rowsC.push(j); if (rowsC.at(-1) !== rows - 1) rowsC.push(rows - 1);
    const colsC = []; for (let i = 0; i < cols; i += step) colsC.push(i); if (colsC.at(-1) !== cols - 1) colsC.push(cols - 1);
    const E = new Float64Array(rowsC.length * colsC.length); const N = new Float64Array(E.length);
    rowsC.forEach((j, a) => colsC.forEach((i, b) => {
      const u = utmForward((meta.latTopArcsec - j) / 3600, (meta.lonLeftArcsec + i) / 3600, zone);
      E[a * colsC.length + b] = u.e; N[a * colsC.length + b] = u.n;
    }));
    let a = 0;
    for (let j = 0; j < rows; j++) {
      while (a < rowsC.length - 2 && rowsC[a + 1] <= j) a++;
      const ty = (j - rowsC[a]) / (rowsC[a + 1] - rowsC[a]);
      let b = 0;
      for (let i = 0; i < cols; i++) {
        while (b < colsC.length - 2 && colsC[b + 1] <= i) b++;
        const tx = (i - colsC[b]) / (colsC[b + 1] - colsC[b]);
        const q = a * colsC.length + b; const q2 = q + colsC.length;
        const e = (E[q] * (1 - tx) + E[q + 1] * tx) * (1 - ty) + (E[q2] * (1 - tx) + E[q2 + 1] * tx) * ty;
        const n = (N[q] * (1 - tx) + N[q + 1] * tx) * (1 - ty) + (N[q2] * (1 - tx) + N[q2 + 1] * tx) * ty;
        const k = j * cols + i;
        uv[k * 2] = (e - e0) / widthM;
        uv[k * 2 + 1] = (n0 - n) / heightM; // texture row 0 = north, flipY = false
      }
    }
    for (let k = rows * cols; k < position.count; k++) {
      const ll = unprojectXZ(position.getX(k), position.getZ(k), center);
      const u = utmForward(ll.lat, ll.lon, zone);
      uv[k * 2] = (u.e - e0) / widthM;
      uv[k * 2 + 1] = (n0 - u.n) / heightM;
    }
    entry.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    entry.uvKey = sat.uvKey;
    entry.uvMs = Math.round(performance.now() - started);
  }
  function applyPatchMaterial(entry) {
    if (!entry) return;
    const sat = satelliteFor(entry);
    if (sat) ensureUv(entry, sat);
    entry.mesh.material = sat ? sat.material : patchMaterial;
  }

  function requestShadowUpdate(reason) {
    const active = activePatchId ? patches.peek(activePatchId) : null;
    if (satelliteFor(active)) { shadowSkipped += 1; return; } // Satellite: no cast shadows
    renderer.shadowMap.needsUpdate = true;
    lastShadowRequest = reason;
  }

  function setClip(entry) {
    if (!entry) { clipUniforms.uClipOn.value = 0; return; }
    entry.corners.forEach((p, k) => clipUniforms.uClipQuad.value[k].set(p.x, p.z));
    clipUniforms.uClipOn.value = 1;
  }

  function showPatch(id) {
    for (const key of patches.keys()) {
      const entry = patches.peek(key);
      entry.mesh.visible = key === id && terrainMode === 'glo30';
    }
    const entry = id ? patches.get(id) : null;
    if (!entry || terrainMode !== 'glo30') { setClip(null); fade = null; return; }
    aimSunAt(entry.center);
    applyPatchMaterial(entry);
    const material = entry.mesh.material;
    if (reducedMotion()) {
      material.transparent = false; material.opacity = 1; material.needsUpdate = true;
      setClip(entry);
      fade = null;
    } else {
      material.transparent = true; material.opacity = 0; material.needsUpdate = true;
      setClip(null);
      fade = { start: performance.now(), entry, material };
    }
    requestShadowUpdate('patch');
  }

  async function loadPatch(id) {
    const meta = getPatchMeta(id);
    if (!meta) return;
    if (patches.has(id)) { showPatch(id); return; }
    if (patchStates.get(id) === 'loading') return;
    patchStates.set(id, 'loading');
    onTerrainEvent({ type: 'patch-loading', peakId: id });
    const started = performance.now();
    try {
      const [bytes, zstd] = await Promise.all([fetchPatch(meta.file, `himalaya-patch:${id}`, disposeController.signal), loadZstd()]);
      if (disposed) return;
      const { heights } = decodePatch(new Uint8Array(bytes), meta, zstd);
      const built = buildPatchGeometry(meta, heights, center);
      if (disposed) { built.geometry.dispose(); return; }
      const mesh = new THREE.Mesh(built.geometry, patchMaterial);
      mesh.name = `glo30-${id}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      const p = projectLonLat(meta.lonLeftArcsec / 3600 + (meta.cols - 1) / 7200, meta.latTopArcsec / 3600 - (meta.rows - 1) / 7200, center);
      const entry = { id, mesh, geometry: built.geometry, fullIndex: built.fullIndex, coarseIndex: built.coarseIndex, lod: 'coarse',
        corners: patchCornersXZ(meta, center), center: new THREE.Vector3(p.x, heightKm((meta.minM + meta.maxM) / 2), p.z),
        triangles: { full: built.fullTriangles, coarse: built.coarseTriangles }, vertices: built.vertexCount,
        buildMs: Math.round(performance.now() - started) };
      patches.set(id, entry, { isPinned: (key) => key === activePatchId });
      patchStates.set(id, 'ready');
      onTerrainEvent({ type: 'patch-ready', peakId: id, buildMs: entry.buildMs });
      if (activePatchId === id) showPatch(id);
    } catch (error) {
      if (disposed) return;
      patchStates.set(id, 'error');
      patchErrors.set(id, error?.message || String(error));
      console.warn(`[Living Himalaya] GLO-30 patch ${id} unavailable.`, error?.message || error);
      onTerrainEvent({ type: 'patch-error', peakId: id, error: error?.message || String(error) });
    }
  }

  // --- camera
  const overviewTarget = new THREE.Vector3(...OVERVIEW_VIEW.target);
  const overviewPosition = new THREE.Vector3(...OVERVIEW_VIEW.position);
  camera.position.copy(overviewPosition);
  controls.target.copy(overviewTarget);
  controls.update();

  let flight = null;
  function setView(target, position) {
    flight = null;
    controls.target.copy(target);
    camera.position.copy(position);
    controls.update();
  }
  function flyTo(target, position) {
    if (reducedMotion()) { setView(target, position); return; }
    flight = { start: performance.now(), fromTarget: controls.target.clone(), fromPosition: camera.position.clone(), toTarget: target.clone(), toPosition: position.clone() };
  }
  function peakView(id) {
    const marker = markers.get(id);
    if (!marker) return null;
    const target = marker.top.clone().add(new THREE.Vector3(0, -1.6, 0));
    return { target, position: target.clone().add(new THREE.Vector3(-5, 7.5, 17)) };
  }

  let activeId = null;
  function setActive(id) {
    if (activeId && markers.has(activeId)) {
      const previous = markers.get(activeId);
      previous.head.material = headMaterial;
      previous.label.classList.remove('is-active');
    }
    activeId = markers.has(id) ? id : null;
    if (activeId) {
      const marker = markers.get(activeId);
      marker.head.material = activeMaterial;
      marker.label.classList.add('is-active');
    }
  }

  // --- the Sun
  function aimSunAt(target) {
    sun.target.position.copy(target);
    sun.target.updateMatrixWorld();
    if (sunState) {
      sun.position.copy(target).addScaledVector(sunState.direction, 120);
      sun.updateMatrixWorld();
    }
  }
  function setSun({ azimuthDeg, altitudeDeg, lon, lat, source }) {
    const basis = localBasis(lon, lat, center);
    const d = sunDirectionScene(azimuthDeg, altitudeDeg, basis);
    const direction = new THREE.Vector3(d.x, d.y, d.z).normalize();
    const changed = !sunState || sunState.direction.angleTo(direction) > 0.0005;
    sunState = { azimuthDeg, altitudeDeg, lon, lat, source, direction };
    const up = Math.max(0, Math.sin((altitudeDeg * Math.PI) / 180));
    sun.intensity = altitudeDeg > 0 ? 0.6 + 2.2 * Math.min(1, up * 3) : 0;
    sky.intensity = altitudeDeg > 0 ? 0.32 : Math.max(0.1, 0.32 + altitudeDeg * 0.03);
    const entry = activePatchId && terrainMode === 'glo30' ? patches.peek(activePatchId) : null;
    aimSunAt(entry ? entry.center : sun.target.position);
    if (changed) requestShadowUpdate('sun');
  }

  function setMoon(moon) {
    if (!moon) { moonState = null; moonLight.intensity = 0; return; }
    const basis = localBasis(moon.lon, moon.lat, center);
    const d = sunDirectionScene(moon.azimuthDeg, moon.altitudeDeg, basis);
    const direction = new THREE.Vector3(d.x, d.y, d.z).normalize();
    moonState = { ...moon, direction };
    moonLight.intensity = moonlightIntensity(moon);
    moonLight.target.position.copy(sun.target.position);
    moonLight.target.updateMatrixWorld();
    moonLight.position.copy(sun.target.position).addScaledVector(direction, 120);
    moonLight.updateMatrixWorld();
  }

  // --- render loop and resize
  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    labelRenderer.setSize(width, height);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    overviewDirty = true;
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  let frameId = 0;
  let frames = 0;
  let fpsWindowStart = performance.now();
  let fps = null;
  let lastOverviewUpdate = 0;
  const lastCamera = new THREE.Matrix4();
  function frame(now) {
    frameId = requestAnimationFrame(frame);
    if (flight) {
      const t = Math.min(1, (now - flight.start) / FLY_DURATION_MS);
      const k = easeInOutCubic(t);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
      camera.position.lerpVectors(flight.fromPosition, flight.toPosition, k);
      if (t >= 1) flight = null;
    }
    controls.update();
    // Near-plane follows the distance to the target (log depth handles the rest).
    const distance = camera.position.distanceTo(controls.target);
    camera.near = Math.max(0.02, Math.min(5, distance * 0.002));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const moved = !lastCamera.equals(camera.matrixWorld);
    if ((moved || overviewDirty) && now - lastOverviewUpdate > 180) {
      overview.update();
      lastOverviewUpdate = now;
      overviewDirty = false;
      lastCamera.copy(camera.matrixWorld);
    }
    // Patch fade and LOD.
    if (fade) {
      const t = Math.min(1, (now - fade.start) / PATCH_FADE_MS);
      fade.material.opacity = t;
      if (t >= 1) {
        fade.material.transparent = false; fade.material.needsUpdate = true;
        setClip(fade.entry);
        fade = null;
      }
    }
    const active = activePatchId && terrainMode === 'glo30' ? patches.peek(activePatchId) : null;
    if (active) {
      const lod = camera.position.distanceTo(active.center) < FULL_LOD_DISTANCE_KM ? 'full' : 'coarse';
      if (lod !== active.lod) {
        active.geometry.setIndex(lod === 'full' ? active.fullIndex : active.coarseIndex);
        active.lod = lod;
        requestShadowUpdate('lod');
      }
    }
    // Marker heads keep a roughly constant on-screen size.
    for (const marker of markers.values()) {
      const s = Math.max(0.02, camera.position.distanceTo(marker.top) * 0.0065);
      marker.head.scale.setScalar(s);
    }
    gridMaterial.opacity = THREE.MathUtils.clamp((distance - 150) / 900, 0, 1) * 0.22;
    grid.visible = gridMaterial.opacity > 0.005;
    if (renderer.shadowMap.needsUpdate) shadowUpdates += 1;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    frames += 1;
    if (now - fpsWindowStart >= 1000) {
      fps = Math.round((frames * 1000) / (now - fpsWindowStart));
      frames = 0;
      fpsWindowStart = now;
    }
  }
  frameId = requestAnimationFrame(frame);

  function gpuBufferBytes() {
    let bytes = 0;
    const seen = new Set();
    scene.traverse((object) => {
      const g = object.geometry;
      if (!g || seen.has(g)) return;
      seen.add(g);
      for (const attribute of Object.values(g.attributes)) bytes += attribute.array.byteLength;
      if (g.index) bytes += g.index.array.byteLength;
    });
    for (const entry of patches.keys().map((k) => patches.peek(k))) {
      const other = entry.lod === 'full' ? entry.coarseIndex : entry.fullIndex;
      if (other) bytes += other.array.byteLength;
    }
    return bytes;
  }

  return Object.freeze({
    focusPeak(id, { instant = false } = {}) {
      const view = peakView(id);
      if (!view) return false;
      setActive(id);
      activePatchId = id;
      if (instant) setView(view.target, view.position);
      else flyTo(view.target, view.position);
      if (terrainMode === 'glo30') {
        if (patches.has(id)) showPatch(id);
        else { showPatch(null); loadPatch(id); }
      }
      return true;
    },
    overview({ instant = false } = {}) {
      setActive(null);
      activePatchId = null;
      showPatch(null);
      if (instant) setView(overviewTarget, overviewPosition);
      else flyTo(overviewTarget, overviewPosition);
    },
    setTerrainMode(mode) {
      if (mode !== 'glo30' && mode !== 'terrarium') return;
      terrainMode = mode;
      if (mode === 'glo30' && activePatchId) {
        if (patches.has(activePatchId)) showPatch(activePatchId);
        else loadPatch(activePatchId);
      } else {
        showPatch(null);
      }
    },
    setSun,
    setMoon,
    /** Sentinel-2 mosaic for a summit: { rgba, width, height, level, res, utm: { zone, e0, n0, widthM, heightM } }. */
    setSatelliteImage(peakId, image) {
      const previous = satellite.get(peakId);
      previous?.texture.dispose();
      previous?.material.dispose();
      const texture = new THREE.DataTexture(image.rgba, image.width, image.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.needsUpdate = true;
      const material = new THREE.MeshBasicMaterial({ map: texture });
      const { zone, e0, n0, widthM, heightM } = image.utm;
      satellite.set(peakId, { texture, material, utm: image.utm, uvKey: `${zone}:${e0}:${n0}:${widthM}:${heightM}`, width: image.width, height: image.height, level: image.level, res: image.res });
      const entry = patches.peek(peakId);
      if (entry && peakId === activePatchId) applyPatchMaterial(entry);
    },
    clearSatelliteImage(peakId) {
      const sat = satellite.get(peakId);
      if (!sat) return;
      satellite.delete(peakId);
      const entry = patches.peek(peakId);
      if (entry && entry.mesh.material === sat.material) entry.mesh.material = patchMaterial;
      sat.texture.dispose();
      sat.material.dispose();
    },
    /** 'satellite' | 'lit'; shadows are recomputed only when entering Lit terrain. */
    setImageMode(mode) {
      if (mode !== 'satellite' && mode !== 'lit') return;
      const changed = mode !== imageMode;
      imageMode = mode;
      const entry = activePatchId && terrainMode === 'glo30' ? patches.peek(activePatchId) : null;
      applyPatchMaterial(entry);
      if (changed && mode === 'lit') requestShadowUpdate('mode');
    },
    satelliteShown: () => {
      const entry = activePatchId && terrainMode === 'glo30' ? patches.peek(activePatchId) : null;
      return Boolean(entry && entry.mesh.visible && satelliteFor(entry) && entry.mesh.material === satelliteFor(entry).material);
    },
    /** Camera distance (km) to the focused summit (official elevation). */
    summitDistanceKm: () => {
      const marker = activeId ? markers.get(activeId) : null;
      return marker ? camera.position.distanceTo(marker.top) : null;
    },
    patchDistanceKm: () => {
      const entry = activePatchId ? patches.peek(activePatchId) : null;
      return entry ? camera.position.distanceTo(entry.center) : null;
    },
    /** Debug/verification: place the camera directly ([x,y,z] km). */
    setView: (target, position) => setView(new THREE.Vector3(...target), new THREE.Vector3(...position)),
    terrariumSummit: (id) => terrariumSummits.get(id) || null,
    patchState: (id) => patchStates.get(id) || null,
    isFlying: () => Boolean(flight),
    /** GPU cost of one shadow-map recomputation (ms): render with vs without the update, gl.finish() each. */
    measureShadowCost(samples = 5) {
      const gl = renderer.getContext();
      const time = (withShadow) => {
        if (withShadow) renderer.shadowMap.needsUpdate = true;
        const t0 = performance.now();
        renderer.render(scene, camera);
        gl.finish();
        return performance.now() - t0;
      };
      time(false); time(true);
      const base = []; const shadow = [];
      for (let i = 0; i < samples; i++) { base.push(time(false)); shadow.push(time(true)); }
      const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const entry = activePatchId ? patches.peek(activePatchId) : null;
      return { baseMs: +median(base).toFixed(2), withShadowMs: +median(shadow).toFixed(2), costMs: +(median(shadow) - median(base)).toFixed(2), lod: entry?.lod || null };
    },
    /**
     * Same comparison measured on the GPU with EXT_disjoint_timer_query_webgl2
     * (TIME_ELAPSED around one render with / without the shadow-map update).
     */
    async measureShadowCostGpu(samples = 6) {
      const gl = renderer.getContext();
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!ext) return { available: false };
      const runOne = (withShadow) => {
        if (withShadow) renderer.shadowMap.needsUpdate = true;
        const query = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        renderer.render(scene, camera);
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        return query;
      };
      const pending = [];
      for (let i = 0; i < samples; i++) { pending.push(['base', runOne(false)]); pending.push(['shadow', runOne(true)]); }
      const started = performance.now();
      while (pending.some(([, q]) => !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) && performance.now() - started < 3000) {
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const results = { base: [], shadow: [] };
      for (const [kind, q] of pending) {
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) results[kind].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
      const median = (values) => (values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : null);
      const base = median(results.base); const shadow = median(results.shadow);
      const entry = activePatchId ? patches.peek(activePatchId) : null;
      return { available: true, disjoint, samples: results.base.length, baseGpuMs: base && +base.toFixed(3), withShadowGpuMs: shadow && +shadow.toFixed(3),
        costGpuMs: base != null && shadow != null ? +(shadow - base).toFixed(3) : null, lod: entry?.lod || null, triangles: entry?.triangles || null };
    },
    snapshot: () => {
      const entry = activePatchId ? patches.peek(activePatchId) : null;
      return {
        activeId, flying: Boolean(flight), fps, terrainMode,
        target: controls.target.toArray(), camera: camera.position.toArray(),
        patch: entry ? { id: entry.id, visible: entry.mesh.visible, lod: entry.lod, triangles: entry.triangles, vertices: entry.vertices, buildMs: entry.buildMs, fading: Boolean(fade), clipOn: clipUniforms.uClipOn.value === 1 } : { id: activePatchId, state: activePatchId ? patchStates.get(activePatchId) || null : null, error: activePatchId ? patchErrors.get(activePatchId) || null : null },
        patchesInMemory: patches.keys(),
        overview: overview.stats(),
        overviewIdle: overview.idle(),
        sun: sunState ? { azimuthDeg: +sunState.azimuthDeg.toFixed(2), altitudeDeg: +sunState.altitudeDeg.toFixed(2), source: sunState.source, direction: sunState.direction.toArray().map((v) => +v.toFixed(4)), intensity: +sun.intensity.toFixed(3) } : null,
        image: (() => {
          const entry = activePatchId ? patches.peek(activePatchId) : null;
          const sat = activePatchId ? satellite.get(activePatchId) : null;
          return { mode: imageMode, available: Boolean(sat), level: sat?.level ?? null, res: sat?.res ?? null, size: sat ? [sat.width, sat.height] : null,
            material: entry ? entry.mesh.material.type : null, uvMs: entry?.uvMs ?? null, shadowSkipped, satelliteImages: [...satellite.keys()] };
        })(),
        moon: moonState ? { azimuthDeg: +moonState.azimuthDeg.toFixed(2), altitudeDeg: +moonState.altitudeDeg.toFixed(2), phaseFraction: +moonState.phaseFraction.toFixed(3), intensity: +moonLight.intensity.toFixed(3), castShadow: moonLight.castShadow } : null,
        shadow: { mapSize: SHADOW_MAP_SIZE, autoUpdate: renderer.shadowMap.autoUpdate, updates: shadowUpdates, lastReason: lastShadowRequest },
        gpu: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, bufferBytes: gpuBufferBytes(), shadowMapBytes: SHADOW_MAP_SIZE * SHADOW_MAP_SIZE * 4 },
        verticalExaggeration: VERTICAL_EXAGGERATION,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeController.abort(new DOMException('Living Himalaya scene disposed', 'AbortError'));
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      overview.dispose();
      patches.clear();
      for (const sat of satellite.values()) { sat.texture.dispose(); sat.material.dispose(); }
      satellite.clear();
      disposables.forEach((resource) => resource.dispose());
      sun.shadow.map?.dispose();
      labelRenderer.domElement.remove();
      gridLabels.length = 0;
      markers.clear();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  });
}
