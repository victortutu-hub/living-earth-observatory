// LOT 48: cartoon geometry of an AlphaFold model (from the LOT 47 prototype, direction B).
// - One swept mesh per contiguous segment along the C-alpha spline; the cross-section follows the DSSP class of the
//   residue (src/protein/protein-geometry.js parseAlphaFoldCif): helix (alpha, 3-10, pi) = flat ribbon, strand =
//   flat band ending in an arrow head, anything else = round tube.
// - The ribbon side comes from the backbone carbonyl (C -> O), kept consistent along the chain.
// - Colour per residue: the AlphaFold DB pLDDT palette (unchanged). Ambient occlusion per vertex from residue burial
//   (C-alpha neighbours within 10 Å): rendering only (stylisation), not data.
import { plddtBand } from './protein-geometry.js';

export const CARTOON_SHAPE = Object.freeze({
  samplesPerResidue: 8,
  radialSegments: 12,
  helix: Object.freeze([1.15, 0.26]), // half width, half thickness (Å)
  strand: Object.freeze([0.95, 0.3]),
  arrowHead: 1.75,
  coil: Object.freeze([0.3, 0.3]),
  burialRadius: 10,
});

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** C-alpha neighbours within `radius` Å, per atom (all atoms of the model, every segment). */
export function residueBurial(atoms, radius = CARTOON_SHAPE.burialRadius) {
  const r2 = radius * radius;
  return atoms.map((a) => {
    let n = 0;
    for (const b of atoms) { if (a === b) continue; const dx = a.x - b.x; const dy = a.y - b.y; const dz = a.z - b.z; if (dx * dx + dy * dy + dz * dz < r2) n += 1; }
    return n;
  });
}

/** Ambient-occlusion factor in [1 - strength, 1] from a burial count (stylisation). */
export function occlusionFactor(burial, maxBurial, strength = 0.62) {
  return 1 - strength * smoothstep(0.15, 1, burial / Math.max(1, maxBurial));
}

/** Half width / half thickness at a point between residue i0 and i1 (fraction f), from the DSSP classes. */
export function cartoonSection(kinds, i0, i1, f) {
  const n = kinds.length;
  const isLastStrand = (i) => kinds[i] === 'strand' && (i + 1 >= n || kinds[i + 1] !== 'strand');
  const at = (i, frac) => {
    if (kinds[i] === 'helix') return CARTOON_SHAPE.helix;
    if (kinds[i] === 'strand') return isLastStrand(i) ? [CARTOON_SHAPE.arrowHead * (1 - frac), CARTOON_SHAPE.strand[1]] : CARTOON_SHAPE.strand;
    return CARTOON_SHAPE.coil;
  };
  if (isLastStrand(i0)) return at(i0, f); // the arrow head tapers inside its own residue
  const a = at(i0, f); const b = at(i1, 0); const g = smoothstep(0, 1, f);
  return [a[0] * (1 - g) + b[0] * g, a[1] * (1 - g) + b[1] * g];
}

/**
 * The swept mesh of one contiguous segment. `atoms` = residues of the segment (x, y, z, plddt, optional c / o),
 * `kinds` = 'helix' | 'strand' | 'coil' per residue, `occlusion` = AO factor per residue, `center` = [x, y, z] subtracted.
 */
export function buildCartoonGeometry(THREE, atoms, kinds, occlusion, center = [0, 0, 0], colorOf = (atom) => plddtBand(atom.plddt).color) {
  const S = CARTOON_SHAPE.samplesPerResidue; const N = CARTOON_SHAPE.radialSegments;
  const points = atoms.map((a) => new THREE.Vector3(a.x - center[0], a.y - center[1], a.z - center[2]));
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const count = (atoms.length - 1) * S + 1;
  const last = atoms.length - 1;
  const sides = []; let previous = null;
  for (let i = 0; i < atoms.length; i += 1) {
    const t = curve.getTangent(i / last);
    const a = atoms[i];
    let side = a.c && a.o ? new THREE.Vector3(a.o[0] - a.c[0], a.o[1] - a.c[1], a.o[2] - a.c[2]) : new THREE.Vector3(0, 1, 0);
    side.sub(t.clone().multiplyScalar(side.dot(t)));
    if (side.lengthSq() < 1e-8) side = previous ? previous.clone() : new THREE.Vector3(1, 0, 0).cross(t);
    side.normalize();
    if (previous && side.dot(previous) < 0) side.negate();
    sides.push(side); previous = side;
  }
  const positions = new Float32Array(count * N * 3);
  const colors = new Float32Array(count * N * 3);
  const ao = new Float32Array(count * N);
  const color = new THREE.Color();
  const p = new THREE.Vector3(); const v = new THREE.Vector3(); const side = new THREE.Vector3(); const normal = new THREE.Vector3();
  for (let k = 0; k < count; k += 1) {
    const u = k / (count - 1); const fi = k / S; const i0 = Math.min(last, Math.floor(fi)); const i1 = Math.min(last, i0 + 1); const f = fi - i0;
    curve.getPoint(u, p);
    const t = curve.getTangent(u);
    side.copy(sides[i0]).lerp(sides[i1], f);
    side.sub(t.clone().multiplyScalar(side.dot(t))).normalize();
    normal.crossVectors(t, side).normalize();
    const nearest = f < 0.5 ? i0 : i1;
    const [w, h] = cartoonSection(kinds, i0, i1, f);
    color.setHex(colorOf(atoms[nearest]));
    const occl = occlusion[nearest];
    for (let j = 0; j < N; j += 1) {
      const angle = (j / N) * Math.PI * 2;
      v.copy(p).addScaledVector(side, Math.cos(angle) * w).addScaledVector(normal, Math.sin(angle) * h);
      const o = k * N + j;
      positions[o * 3] = v.x; positions[o * 3 + 1] = v.y; positions[o * 3 + 2] = v.z;
      colors[o * 3] = color.r; colors[o * 3 + 1] = color.g; colors[o * 3 + 2] = color.b;
      ao[o] = occl;
    }
  }
  const index = [];
  for (let k = 0; k < count - 1; k += 1) for (let j = 0; j < N; j += 1) {
    const a = k * N + j; const b = k * N + ((j + 1) % N); const c = (k + 1) * N + j; const d = (k + 1) * N + ((j + 1) % N);
    index.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aoFactor', new THREE.BufferAttribute(ao, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Lit material: vertex colours = the pLDDT palette; ambient occlusion from burial (darker ambient, half of it on the
 * direct light), a narrow specular highlight and a faint rim light. Stylisation, declared in the UI.
 */
export function createCartoonMaterial(THREE) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.0 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aoFactor;\nvarying float vAoLp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAoLp = aoFactor;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAoLp;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAoLp * vAoLp;\nreflectedLight.directDiffuse *= mix(1.0, vAoLp, 0.7);\nreflectedLight.directSpecular *= vAoLp;')
      .replace('#include <opaque_fragment>', '{ float rimLp = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 3.0); outgoingLight += vec3(0.55, 0.72, 1.0) * rimLp * 0.12 * vAoLp; }\n#include <opaque_fragment>');
  };
  return material;
}
