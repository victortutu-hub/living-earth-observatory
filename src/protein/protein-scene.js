import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCartoonGeometry, createCartoonMaterial, occlusionFactor, residueBurial } from './protein-cartoon.js';

// LOT 48: cartoon of the AlphaFold model (DSSP classes from the mmCIF), lit material with ambient occlusion from residue
// burial, depth fog only behind the molecule's centre. The camera frames the residues with pLDDT >= 70 (framing atoms
// given by the app) inside the free area of the screen (the cards' insets). The former additive "halo" (a scaled copy
// of the whole structure, LOT 47 finding) is gone.
export const FALLBACK_COLOR = 0x7d8799;

function dispose(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
    else child.material?.dispose();
  });
}

export function createProteinScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x04050b, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x04050b, 100, 300);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 4000);
  camera.position.set(0, 0, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 8;
  controls.maxDistance = 1200;
  // A dim, cool ambient (the occlusion acts on it) and one key light: depth reads from shading, not from colour.
  scene.add(new THREE.HemisphereLight(0xc9d8ff, 0x120c1e, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(40, 60, 80);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fb4ff, 0.35);
  fill.position.set(-60, -25, 30);
  scene.add(fill);
  const root = new THREE.Group();
  scene.add(root);
  let frameId = 0;
  let structure = null;
  let structureCenter = [0, 0, 0];
  let currentSegments = [];
  let featureFocus = null;
  let featureFrame = null;
  let focusTransition = false;
  let defaultCameraDistance = 120;
  let framingSphere = null;
  let insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let spin = true;
  controls.addEventListener('start', () => { spin = false; });
  const focusCameraDirection = new THREE.Vector3(0, 0, 1);
  const focusWorldTarget = new THREE.Vector3();
  const focusCameraTarget = new THREE.Vector3();

  // The projection centre moves to the centre of the free area (viewport minus the cards).
  function applyViewOffset() {
    const width = canvas.clientWidth; const height = canvas.clientHeight;
    if (!width || !height) return;
    const freeW = Math.max(1, width - insets.left - insets.right);
    const freeH = Math.max(1, height - insets.top - insets.bottom);
    const cx = insets.left + freeW / 2; const cy = insets.top + freeH / 2;
    camera.setViewOffset(width, height, width / 2 - cx, height / 2 - cy, width, height);
    camera.updateProjectionMatrix();
  }

  function fitDistance() {
    if (!framingSphere) return defaultCameraDistance;
    const width = canvas.clientWidth || 1; const height = canvas.clientHeight || 1;
    const freeW = Math.max(1, width - insets.left - insets.right); const freeH = Math.max(1, height - insets.top - insets.bottom);
    const vFov = THREE.MathUtils.degToRad(camera.fov) * (freeH / height);
    const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (freeW / height));
    return (framingSphere.radius * 1.08) / Math.sin(Math.min(vFov, hFov) / 2);
  }

  function frameStructure() {
    const distance = fitDistance();
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
    direction.normalize();
    controls.target.set(0, 0, 0);
    camera.position.copy(direction.multiplyScalar(distance));
    controls.update();
    defaultCameraDistance = distance;
    // Depth cue only behind the molecule's centre: the near side keeps its pLDDT colours (stylisation).
    const radius = framingSphere?.radius || 40;
    scene.fog.near = distance;
    scene.fog.far = distance + radius * 4;
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    applyViewOffset();
  }

  /**
   * segments: contiguous residues ({ residue, x, y, z, plddt, c?, o? }); kindOf(atom) -> 'helix' | 'strand' | 'coil';
   * framing: the atoms the camera frames (pLDDT >= 70, or all).
   */
  // neutral: the illustrative fallback trace (error state only) is drawn in one grey, never in the pLDDT palette.
  function renderStructure({ segments, kindOf = () => 'coil', framing = null, neutral = false }) {
    if (structure) { root.remove(structure); dispose(structure); }
    clearFeatureFocus();
    structure = new THREE.Group();
    currentSegments = segments;
    const allAtoms = segments.flat();
    const center = allAtoms.reduce((sum, atom) => [sum[0] + atom.x, sum[1] + atom.y, sum[2] + atom.z], [0, 0, 0]).map((value) => value / allAtoms.length);
    structureCenter = center;
    const burial = residueBurial(allAtoms);
    const maxBurial = Math.max(1, ...burial);
    const occlusion = new Map(allAtoms.map((atom, index) => [atom, occlusionFactor(burial[index], maxBurial)]));
    const material = createCartoonMaterial(THREE); // disposed with the structure
    for (const atoms of segments) {
      if (atoms.length < 2) continue;
      const geometry = buildCartoonGeometry(THREE, atoms, atoms.map(kindOf), atoms.map((atom) => occlusion.get(atom)), center, neutral ? () => FALLBACK_COLOR : undefined);
      structure.add(new THREE.Mesh(geometry, material));
    }
    structure.rotation.set(-0.32, -0.48, 0.12);
    root.add(structure);
    structure.updateMatrixWorld(true);
    const frameAtoms = framing?.length ? framing : allAtoms;
    const points = frameAtoms.map((atom) => new THREE.Vector3(atom.x - center[0], atom.y - center[1], atom.z - center[2]).applyMatrix4(structure.matrixWorld));
    framingSphere = new THREE.Sphere().setFromPoints(points);
    // Orbit around the framed part: the structure moves so that its framed centre is at the origin.
    structure.position.sub(framingSphere.center);
    framingSphere.center.set(0, 0, 0);
    camera.position.set(0, 0.06, 1);
    controls.target.set(0, 0, 0);
    frameStructure();
    featureFrame = null;
    focusTransition = false;
    spin = true;
  }

  /** No geometry at all (the loading state: nothing is drawn until the model file arrives). */
  function clearStructure() {
    clearFeatureFocus();
    if (structure) { root.remove(structure); dispose(structure); }
    structure = null;
    currentSegments = [];
    framingSphere = null;
  }

  function setInsets(next) {
    insets = { top: 0, right: 0, bottom: 0, left: 0, ...next };
    applyViewOffset();
    if (framingSphere && !featureFocus) frameStructure();
  }

  function clearFeatureFocus() {
    if (!featureFocus || !structure) return;
    structure.remove(featureFocus);
    dispose(featureFocus);
    featureFocus = null;
    featureFrame = null;
    focusTransition = false;
  }

  function focusFeature(start, end) {
    clearFeatureFocus();
    if (!structure) return false;
    const focusGroup = new THREE.Group();
    const focusAtoms = [];
    const local = (atom) => new THREE.Vector3(atom.x - structureCenter[0], atom.y - structureCenter[1], atom.z - structureCenter[2]);
    for (const segment of currentSegments) {
      const atoms = segment.filter((atom) => atom.residue >= start && atom.residue <= end);
      if (atoms.length < 2) continue;
      focusAtoms.push(...atoms);
      const curve = new THREE.CatmullRomCurve3(atoms.map(local), false, 'centripetal');
      const geometry = new THREE.TubeGeometry(curve, Math.max(14, atoms.length * 3), 1.35, 10, false);
      focusGroup.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.28, depthWrite: false, fog: false, toneMapped: false })));
    }
    if (!focusGroup.children.length) {
      dispose(focusGroup);
      return false;
    }
    const localCenter = focusAtoms.reduce((sum, atom) => sum.add(local(atom)), new THREE.Vector3()).multiplyScalar(1 / focusAtoms.length);
    const radius = Math.max(4, ...focusAtoms.map((atom) => localCenter.distanceTo(local(atom))));
    featureFocus = focusGroup;
    focusCameraDirection.copy(camera.position).sub(controls.target).normalize();
    featureFrame = { localCenter, distance: THREE.MathUtils.clamp(radius * 4.8, 26, defaultCameraDistance * 0.78) };
    focusTransition = true;
    spin = false;
    structure.add(featureFocus);
    return true;
  }

  function loop() {
    frameId = requestAnimationFrame(loop);
    if (structure && !featureFocus && spin) {
      root.rotation.y += 0.0009;
      root.updateWorldMatrix(true, true);
    }
    if (focusTransition && featureFrame && structure) {
      focusWorldTarget.copy(featureFrame.localCenter).applyMatrix4(structure.matrixWorld);
      focusCameraTarget.copy(focusCameraDirection).multiplyScalar(featureFrame.distance).add(focusWorldTarget);
      controls.target.lerp(focusWorldTarget, 0.055);
      camera.position.lerp(focusCameraTarget, 0.045);
      if (camera.position.distanceTo(focusCameraTarget) < 0.08 && controls.target.distanceTo(focusWorldTarget) < 0.02) {
        camera.position.copy(focusCameraTarget);
        controls.target.copy(focusWorldTarget);
        focusTransition = false;
      }
    }
    controls.update();
    renderer.render(scene, camera);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  loop();
  return {
    renderStructure,
    clearStructure,
    setInsets,
    focusFeature,
    clearFeatureFocus,
    dispose() { cancelAnimationFrame(frameId); observer.disconnect(); controls.dispose(); renderer.dispose(); if (structure) dispose(structure); },
  };
}
