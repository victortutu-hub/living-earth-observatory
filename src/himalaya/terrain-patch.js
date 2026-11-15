// Living Himalaya LOT 2: one Copernicus GLO-30 patch (20 x 20 km, 1") as a
// mesh. One position/normal set, two index buffers (LOD): FULL (every
// sample) when the camera is near, COARSE (every 2nd row/column, borders
// kept) otherwise. A vertical skirt along the border hides the step to the
// Terrarium overview. Heights at exaggeration 1.0. Grid maths: patch-grid.js.
import * as THREE from 'three';
import { buildPatchArrays } from './patch-grid.js';

export { decodePatch, patchCornersXZ, strideIndices } from './patch-grid.js';
export const FULL_LOD_DISTANCE_KM = 32;

export function buildPatchGeometry(meta, heights, center) {
  const { positions, normals, full, coarse, vertexCount } = buildPatchArrays(meta, heights, center);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const fullIndex = new THREE.BufferAttribute(full, 1);
  const coarseIndex = new THREE.BufferAttribute(coarse, 1);
  geometry.setIndex(coarseIndex);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, fullIndex, coarseIndex, vertexCount, fullTriangles: full.length / 3, coarseTriangles: coarse.length / 3 };
}
