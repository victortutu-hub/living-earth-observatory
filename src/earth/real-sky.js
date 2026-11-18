// LOT 15: the real sky of Living Earth, replacing the procedural star field.
//   * Milky Way: NASA SVS Deep Star Maps 2020 (milkyway_2020, without the
//     Hipparcos/Tycho stars), as two cube maps (log luminance 1024^2, chromaticity
//     256^2), drawn first by a full-screen pass (no depth test or write).
//   * Stars: HYG v4.4 Hipparcos stars with V <= 6.5 as points, after the background,
//     depth-tested against the Earth and the Moon; flux 10^(-0.4 (V + ZP)) on the
//     SAME photometric scale as the background (calibration in src/config/sky-map.js).
//   * Orientation: one mat3 = scene <- (equator of date <- ICRS):
//     EQUATOR_TO_EARTH_SCENE * Rz(-GAST) * Rotation_EQJ_EQD (astronomy-engine),
//     from the Earth time state (time-scrub included). The zodiacal light gets the
//     ecliptic pole through the same matrix.
//   * Exposure: sceneScale = (L per map unit) / L_ref * 2^N, N from the data
//     (brightest background texel below the lowest bloom threshold) - the sky is
//     shown at +N stops relative to the Earth exposure (declared).
// Fallbacks: no map -> point stars only ("Milky Way map unavailable"); no stars ->
// background only; neither -> black sky with a note. Assets through the shared
// request runtime, no persistent cache.
import { SKY_MAP_ASSET } from '../config/sky-map.js';
import { SKY_STARS_ASSET } from '../config/sky-stars.js';
import { ECLIPTIC_POLE_J2000, apply, skyToEarthScene } from '../core/sky/sky-frame.js';
import { STAR_PSF_SIGMA_PX, equatorialTexelSolidAngle, screenPixelSolidAngle } from '../core/sky/sky-photometry.js';
import { createSkyLayer, loadSkyLayer } from '../core/sky/sky-layer.js';
import { loadAstronomyEngine } from './astronomy-runtime.js';
import { atlasStatus } from '../core/status-store.js';

// LOT 15b: shaders, cube construction and star attributes live in src/core/sky/sky-layer.js
// (shared with Living Himalaya); re-exported here for existing callers.
export { buildStarAttributes } from '../core/sky/sky-layer.js';

export const REAL_SKY_EXPOSURE_STOPS = SKY_MAP_ASSET.exposure.stops;
export const REAL_SKY_CREDIT = 'NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC.';
export const REAL_SKY_NOTES = Object.freeze({
  mapUnavailable: 'Milky Way map unavailable — point stars only.',
  starsUnavailable: 'Star catalogue unavailable — Milky Way background only.',
  unavailable: 'Real sky unavailable — black sky.',
});
const ROTATION_REFRESH_MS = 250;

export function createRealSky({
  THREE, scene, getDate, onEclipticNormal = () => {}, loadAstronomy = loadAstronomyEngine,
  baseURI = document.baseURI, noteHost = null,
}) {
  const controller = new AbortController();
  const calibration = SKY_MAP_ASSET.calibration;
  const sceneScale = SKY_MAP_ASSET.exposure.sceneScale;
  const texelSolidAngle = equatorialTexelSolidAngle(SKY_MAP_ASSET.background.width, SKY_MAP_ASSET.background.height);
  const skyMatrix = new THREE.Matrix3();
  const state = { status: 'loading', map: false, stars: false, errors: {}, source: null, siderealHours: null, lastDateMs: NaN, lastUpdate: -Infinity, starCount: 0 };
  let astronomy = null;
  let disposed = false;

  const bufferSize = new THREE.Vector2();
  const layer = createSkyLayer({
    THREE, scene, name: 'real-sky', skyMatrix,
    background: { uniforms: { uScale: { value: sceneScale } } },
    stars: { uniforms: { uFluxToPixels: { value: 0 }, uSigma: { value: STAR_PSF_SIGMA_PX } } },
    onBeforeBackground: () => updateRotation(),
    onBeforeStars: (renderer, camera) => {
      updateRotation();
      renderer.getDrawingBufferSize(bufferSize);
      const pixelRatio = renderer.getPixelRatio();
      starMaterial.uniforms.uSigma.value = STAR_PSF_SIGMA_PX * pixelRatio;
      starMaterial.uniforms.uFluxToPixels.value = (sceneScale * texelSolidAngle) / screenPixelSolidAngle(camera.fov, bufferSize.y);
    },
  });
  const { background, stars, starMaterial } = layer;

  function updateRotation(force = false) {
    const now = performance.now();
    const date = getDate();
    const dateMs = date.getTime();
    if (!force && now - state.lastUpdate < ROTATION_REFRESH_MS && Math.abs(dateMs - state.lastDateMs) < 1000) return;
    const { matrix, siderealHours, source } = skyToEarthScene({ date, Astronomy: astronomy });
    skyMatrix.set(...matrix[0], ...matrix[1], ...matrix[2]);
    state.lastUpdate = now; state.lastDateMs = dateMs; state.siderealHours = siderealHours; state.source = source;
    onEclipticNormal(apply(matrix, ECLIPTIC_POLE_J2000));
  }

  function setNote(text) {
    if (!noteHost) return;
    let note = noteHost.querySelector('[data-real-sky-note]');
    if (!text) { note?.remove(); return; }
    if (!note) { note = document.createElement('li'); note.dataset.realSkyNote = ''; noteHost.prepend(note); }
    note.textContent = `Real sky: ${text}`;
  }

  function publish() {
    const value = state.map && state.stars ? 'MAP + STARS' : state.stars ? 'STARS ONLY' : state.map ? 'MAP ONLY' : 'UNAVAILABLE';
    const note = state.map && state.stars ? null : state.stars ? REAL_SKY_NOTES.mapUnavailable : state.map ? REAL_SKY_NOTES.starsUnavailable : REAL_SKY_NOTES.unavailable;
    state.status = value;
    state.note = note;
    setNote(note);
    atlasStatus.setStatus('realSky', value, state.map && state.stars ? 'ready' : state.map || state.stars ? 'fallback' : 'offline', {
      phase: 'ready', cache: 'memory', reason: note, error: Object.values(state.errors).join('; ') || null, sourceTime: null, updated: new Date().toISOString(),
    });
  }

  updateRotation(true);
  loadAstronomy().then((engine) => { if (!disposed && engine) { astronomy = engine; updateRotation(true); } }).catch(() => {});

  loadSkyLayer({ layer, mapAsset: SKY_MAP_ASSET, starsAsset: SKY_STARS_ASSET, zeroPoint: calibration.zeroPoint, baseURI, signal: controller.signal, isDisposed: () => disposed })
    .then((loaded) => {
      if (disposed) return;
      state.errors = loaded.errors;
      state.map = loaded.map;
      state.stars = loaded.stars;
      if (loaded.stars) state.starCount = loaded.starCount;
      for (const [part, error] of Object.entries(loaded.errors)) console.warn(`[Real sky] ${part} unavailable.`, error);
      publish();
    })
    .catch((error) => { if (!disposed) { state.errors.load = error?.message || String(error); publish(); } });

  const api = {
    background, stars,
    /** Called every frame (frame-runtime): keeps the sky and the zodiacal light oriented even when the sky is hidden. */
    update: () => updateRotation(),
    snapshot: () => ({
      status: state.status, map: state.map, stars: state.stars, starCount: state.starCount, note: state.note || null, errors: { ...state.errors },
      source: state.source, siderealHours: state.siderealHours, matrix: skyMatrix.toArray(), exposureStops: REAL_SKY_EXPOSURE_STOPS, sceneScale,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort(new DOMException('Real sky disposed', 'AbortError'));
      layer.dispose();
      setNote(null);
    },
  };
  background.userData.realSky = api;
  return api;
}
