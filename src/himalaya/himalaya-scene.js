// Living Himalaya LOT 1: a WebGL2 scene WITHOUT terrain. A local lat/lon grid,
// one 3D marker per summit (stem + head + label) and OrbitControls.
// Units: 1 scene unit = 1 km on a local equirectangular plane around the
// region centre. Marker height is the official elevation with a declared
// vertical exaggeration (VERTICAL_EXAGGERATION); there is no ground surface.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const VERTICAL_EXAGGERATION = 10;
export const FLY_DURATION_MS = 1200;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQ = 111.320;
const GRID = Object.freeze({ latMin: 26, latMax: 38, lonMin: 72, lonMax: 92 });

/** Pure projection, exported for tests: lon/lat (deg) -> local km (x east, z south). */
export function projectLonLat(lon, lat, center) {
  const kmPerLon = KM_PER_DEG_LON_EQ * Math.cos((center.lat * Math.PI) / 180);
  return { x: (lon - center.lon) * kmPerLon, z: -(lat - center.lat) * KM_PER_DEG_LAT };
}

export function markerHeightKm(elevationM) {
  return (elevationM / 1000) * VERTICAL_EXAGGERATION;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {HTMLElement} options.labelHost  element for CSS2D labels
 * @param {Array} options.peaks            frozen HIMALAYA_PEAKS
 * @param {{lat:number, lon:number}} options.center
 * @param {(id:string)=>void} options.onSelect
 * @param {()=>boolean} options.reducedMotion
 */
export function createHimalayaScene({ canvas, labelHost, peaks, center, onSelect, reducedMotion }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    throw new Error('WebGL2 is not available.');
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x03060d, 1);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'himalaya-label-layer';
  labelHost.append(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x03060d, 1800, 4200);
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 25;
  controls.maxDistance = 4200;
  controls.screenSpacePanning = false;

  const disposables = [];
  const track = (resource) => { disposables.push(resource); return resource; };

  // --- lat/lon grid (1°), labelled every 2° along the south and west edges.
  const gridPositions = [];
  const push = (a, b) => gridPositions.push(a.x, 0, a.z, b.x, 0, b.z);
  for (let lat = GRID.latMin; lat <= GRID.latMax; lat += 1) {
    for (let lon = GRID.lonMin; lon < GRID.lonMax; lon += 0.5) {
      push(projectLonLat(lon, lat, center), projectLonLat(lon + 0.5, lat, center));
    }
  }
  for (let lon = GRID.lonMin; lon <= GRID.lonMax; lon += 1) {
    push(projectLonLat(lon, GRID.latMin, center), projectLonLat(lon, GRID.latMax, center));
  }
  const gridGeometry = track(new THREE.BufferGeometry());
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
  const gridMaterial = track(new THREE.LineBasicMaterial({ color: 0x2b4a63, transparent: true, opacity: 0.55 }));
  scene.add(new THREE.LineSegments(gridGeometry, gridMaterial));

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
  for (let lon = GRID.lonMin; lon <= GRID.lonMax; lon += 2) addGridLabel(`${lon}°E`, lon, GRID.latMin - 0.35);
  for (let lat = GRID.latMin; lat <= GRID.latMax; lat += 2) addGridLabel(`${lat}°N`, GRID.lonMin - 0.6, lat);

  // --- markers
  const stemMaterial = track(new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.7 }));
  const headGeometry = track(new THREE.SphereGeometry(2.2, 18, 12));
  const headMaterial = track(new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
  const activeMaterial = track(new THREE.MeshBasicMaterial({ color: 0xfde68a }));
  const baseGeometry = track(new THREE.RingGeometry(5, 7, 32));
  const baseMaterial = track(new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));

  const markers = new Map();
  for (const peak of peaks) {
    const p = projectLonLat(peak.lon, peak.lat, center);
    const height = markerHeightKm(peak.elevationM);
    const stemGeometry = track(new THREE.BufferGeometry());
    stemGeometry.setAttribute('position', new THREE.Float32BufferAttribute([p.x, 0, p.z, p.x, height, p.z], 3));
    scene.add(new THREE.LineSegments(stemGeometry, stemMaterial));
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.rotation.x = -Math.PI / 2;
    base.position.set(p.x, 0.2, p.z);
    scene.add(base);
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.set(p.x, height, p.z);
    head.userData.peakId = peak.id;
    scene.add(head);

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'himalaya-peak-label';
    label.dataset.peakId = peak.id;
    label.textContent = `${peak.name} · ${peak.elevationM.toLocaleString('en-US')} m`;
    label.addEventListener('click', () => onSelect(peak.id));
    const labelObject = new CSS2DObject(label);
    labelObject.position.set(p.x, height + 9, p.z);
    scene.add(labelObject);
    markers.set(peak.id, { head, label, labelObject, top: new THREE.Vector3(p.x, height, p.z) });
  }

  // --- picking on marker heads
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const heads = [...markers.values()].map((marker) => marker.head);
  let downAt = null;
  const onPointerDown = (event) => { downAt = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(heads, false)[0];
    if (hit) onSelect(hit.object.userData.peakId);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);

  // --- camera
  const overview = { target: new THREE.Vector3(0, 0, 0), position: new THREE.Vector3(0, 1150, 1250) };
  camera.position.copy(overview.position);
  controls.target.copy(overview.target);
  controls.update();

  let flight = null;
  function setView(target, position) {
    flight = null;
    controls.target.copy(target);
    camera.position.copy(position);
    controls.update();
  }
  function flyTo(target, position) {
    if (reducedMotion()) {
      setView(target, position);
      return;
    }
    flight = {
      start: performance.now(),
      fromTarget: controls.target.clone(),
      fromPosition: camera.position.clone(),
      toTarget: target.clone(),
      toPosition: position.clone(),
    };
  }
  function peakView(id) {
    const marker = markers.get(id);
    if (!marker) return null;
    return { target: marker.top.clone(), position: marker.top.clone().add(new THREE.Vector3(0, 70, 135)) };
  }

  let activeId = null;
  function setActive(id) {
    if (activeId) {
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

  // --- render loop and resize
  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    labelRenderer.setSize(width, height);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  let frameId = 0;
  let frames = 0;
  let fpsWindowStart = performance.now();
  let fps = null;
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

  let disposed = false;
  return Object.freeze({
    focusPeak(id, { instant = false } = {}) {
      const view = peakView(id);
      if (!view) return false;
      setActive(id);
      if (instant) setView(view.target, view.position);
      else flyTo(view.target, view.position);
      return true;
    },
    overview({ instant = false } = {}) {
      setActive(null);
      if (instant) setView(overview.target, overview.position);
      else flyTo(overview.target, overview.position);
    },
    isFlying: () => Boolean(flight),
    snapshot: () => ({ activeId, flying: Boolean(flight), fps, target: controls.target.toArray(), camera: camera.position.toArray() }),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      disposables.forEach((resource) => resource.dispose());
      labelRenderer.domElement.remove();
      gridLabels.length = 0;
      markers.clear();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  });
}
