// LOT 17: is a point hidden by the terrain? Ray march from the point towards the
// camera on the GLO-30 patch heights (the patch geometry's own vertices, laid out
// row-major on the 1" grid), bilinear between samples. Pure: no three.js.
import { unprojectXZ } from './projection.js';

export const OCCLUSION_STEP_KM = 0.06;
export const OCCLUSION_MAX_KM = 25;
export const OCCLUSION_START_KM = 0.15;
export const OCCLUSION_MARGIN_KM = 0.005;

/** Terrain height (km) at scene x/z from the patch vertex positions, or null outside the patch. */
export function patchHeightKmAt({ positions, meta, center }, x, z) {
  const { lon, lat } = unprojectXZ(x, z, center);
  const fj = meta.latTopArcsec - lat * 3600; const fi = lon * 3600 - meta.lonLeftArcsec;
  if (fj < 0 || fi < 0 || fj > meta.rows - 1 || fi > meta.cols - 1) return null;
  const cols = meta.cols;
  const j = Math.min(meta.rows - 2, Math.floor(fj)); const i = Math.min(cols - 2, Math.floor(fi));
  const v = fj - j; const u = fi - i;
  const y = (jj, ii) => positions[(jj * cols + ii) * 3 + 1];
  return (1 - v) * ((1 - u) * y(j, i) + u * y(j, i + 1)) + v * ((1 - u) * y(j + 1, i) + u * y(j + 1, i + 1));
}

/** True when the terrain rises above the straight line from `point` to `camera` (scene km). */
export function terrainOccludes(grid, point, camera) {
  const dx = camera.x - point.x; const dy = camera.y - point.y; const dz = camera.z - point.z;
  const distance = Math.hypot(dx, dy, dz);
  const length = Math.min(distance, OCCLUSION_MAX_KM);
  for (let d = OCCLUSION_START_KM; d < length; d += OCCLUSION_STEP_KM) {
    const t = d / distance;
    const h = patchHeightKmAt(grid, point.x + dx * t, point.z + dz * t);
    if (h === null) return false; // left the detailed terrain
    if (h > point.y + dy * t + OCCLUSION_MARGIN_KM) return true;
  }
  return false;
}
