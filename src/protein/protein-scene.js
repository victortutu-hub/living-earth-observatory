import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { plddtBand } from './protein-geometry.js';

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
  renderer.setClearColor(0x05040c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05040c, 0.006);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2600);
  camera.position.set(0, 0, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.minDistance = 12;
  controls.maxDistance = 900;
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x09030f, 2.2));
  const key = new THREE.DirectionalLight(0xc8a4ff, 3.4);
  key.position.set(60, 75, 110);
  scene.add(key);
  const rim = new THREE.PointLight(0x2bd7f2, 34, 340, 2);
  rim.position.set(-80, -35, 55);
  scene.add(rim);
  const root = new THREE.Group();
  scene.add(root);
  let frameId = 0;
  let structure = null;

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function renderAtoms(segments) {
    if (structure) { root.remove(structure); dispose(structure); }
    structure = new THREE.Group();
    const allAtoms = segments.flat();
    const center = allAtoms.reduce((sum, atom) => sum.add(new THREE.Vector3(atom.x, atom.y, atom.z)), new THREE.Vector3()).multiplyScalar(1 / allAtoms.length);
    for (const atoms of segments) {
      const points = atoms.map((atom) => new THREE.Vector3(atom.x, atom.y, atom.z).sub(center));
      const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      const geometry = new THREE.TubeGeometry(curve, Math.max(16, atoms.length * 2), 0.52, 7, false);
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      const rings = 8;
      const tubularSegments = geometry.parameters.tubularSegments;
      for (let index = 0; index <= tubularSegments; index += 1) {
        const atom = atoms[Math.min(atoms.length - 1, Math.floor(index / tubularSegments * (atoms.length - 1)))];
        const color = new THREE.Color(plddtBand(atom.plddt).color);
        for (let ring = 0; ring < rings; ring += 1) {
          const vertex = index * rings + ring;
          colors[vertex * 3] = color.r;
          colors[vertex * 3 + 1] = color.g;
          colors[vertex * 3 + 2] = color.b;
        }
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // pLDDT is data encoding, so it must remain readable independently of scene lighting.
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
      const trace = new THREE.Mesh(geometry, material);
      structure.add(trace);

      // A faint outer trace keeps low-confidence regions readable without changing pLDDT colors.
      const halo = new THREE.Mesh(
        geometry.clone(),
        new THREE.MeshBasicMaterial({ color: 0x7767d8, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
      );
      halo.scale.setScalar(1.14);
      structure.add(halo);
    }
    structure.rotation.set(-0.32, -0.48, 0.12);
    root.add(structure);
    const box = new THREE.Box3().setFromObject(structure);
    const span = Math.max(24, box.getSize(new THREE.Vector3()).length());
    camera.position.set(0, span * 0.06, span * 1.2);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function loop() {
    frameId = requestAnimationFrame(loop);
    if (structure) structure.rotation.y += 0.0008;
    controls.update();
    renderer.render(scene, camera);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  loop();
  return { renderAtoms, dispose() { cancelAnimationFrame(frameId); observer.disconnect(); controls.dispose(); renderer.dispose(); if (structure) dispose(structure); } };
}
