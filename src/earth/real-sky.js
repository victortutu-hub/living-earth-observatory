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
import { SKY_DECODE_GLSL } from '../core/sky/sky-encoding.js';
import {
  STAR_PSF_SIGMA_PX, equatorialTexelSolidAngle, screenPixelSolidAngle, starFlux,
} from '../core/sky/sky-photometry.js';
import { bvToLinearRgb } from '../core/sky/star-colors.js';
import { createSkyRuntime, loadSkyAssets } from '../core/sky/sky-assets.js';
import { loadAstronomyEngine } from './astronomy-runtime.js';
import { atlasStatus } from '../core/status-store.js';

export const REAL_SKY_EXPOSURE_STOPS = SKY_MAP_ASSET.exposure.stops;
export const REAL_SKY_CREDIT = 'NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC.';
export const REAL_SKY_NOTES = Object.freeze({
  mapUnavailable: 'Milky Way map unavailable — point stars only.',
  starsUnavailable: 'Star catalogue unavailable — Milky Way background only.',
  unavailable: 'Real sky unavailable — black sky.',
});
const ROTATION_REFRESH_MS = 250;

const BACKGROUND_VERT = `
uniform mat4 uInvProjView;
varying vec3 vDir;
void main() {
  vec4 p = uInvProjView * vec4(position.xy, 1.0, 1.0);
  vDir = p.xyz / p.w;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}`;

const BACKGROUND_FRAG = `
uniform samplerCube uLum;
uniform samplerCube uChroma;
uniform mat3 uSkyToScene;
uniform float uScale;
varying vec3 vDir;
${SKY_DECODE_GLSL}
void main() {
  // uSkyToScene maps ICRS -> scene; a rotation, so its inverse is the transpose (v * M).
  vec3 icrs = normalize(vDir) * uSkyToScene;
  vec3 radiance = lumiDecodeSky(textureCube(uLum, icrs).r, textureCube(uChroma, icrs).rg);
  gl_FragColor = vec4(radiance * uScale, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STAR_VERT = `
attribute vec3 aColor;
attribute float aFlux;
uniform mat3 uSkyToScene;
uniform float uFluxToPixels;
uniform float uSigma;
varying vec3 vColor;
varying float vEnergy;
void main() {
  vec3 dir = uSkyToScene * position;
  vec4 view = viewMatrix * vec4(dir, 0.0);
  gl_Position = projectionMatrix * vec4(view.xyz * 50.0, 1.0);
  gl_Position.z = gl_Position.w * 0.9999; // at infinity: behind everything, still depth-tested
  gl_PointSize = ceil(uSigma * 6.0) + 1.0;
  vColor = aColor;
  vEnergy = aFlux * uFluxToPixels;
}`;

const STAR_FRAG = `
uniform float uSigma;
varying vec3 vColor;
varying float vEnergy;
void main() {
  float size = ceil(uSigma * 6.0) + 1.0;
  vec2 p = (gl_PointCoord - 0.5) * size;
  float g = exp(-dot(p, p) / (2.0 * uSigma * uSigma)) / (6.28318530718 * uSigma * uSigma);
  gl_FragColor = vec4(vColor * vEnergy * g, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function loadZstd() {
  return import('three/addons/libs/zstddec.module.js').then(async ({ ZSTDDecoder }) => {
    const decoder = new ZSTDDecoder();
    await decoder.init();
    return { decode: (data, size) => decoder.decode(data, size) };
  });
}

/** Six DataTextures per level -> CubeTexture with explicit mips (no GPU mip generation on log codes). */
function cubeTextureFrom(THREE, cube) {
  const format = cube.channels === 1 ? THREE.RedFormat : THREE.RGFormat;
  const face = (data, size) => new THREE.DataTexture(data, size, size, format, THREE.UnsignedByteType);
  const texture = new THREE.CubeTexture(cube.levels[0].faces.map((data) => face(data, cube.levels[0].size)));
  texture.mipmaps = cube.levels.slice(1).map((level) => ({ image: level.faces.map((data) => face(data, level.size)) }));
  texture.format = format;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Point-star attributes: ICRS unit vectors, luminance-normalised colour, flux in map units. */
export function buildStarAttributes(records, zeroPoint) {
  const count = records.length / 4;
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const flux = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const ra = records[i * 4]; const dec = records[i * 4 + 1];
    position[i * 3] = Math.cos(dec) * Math.cos(ra);
    position[i * 3 + 1] = Math.cos(dec) * Math.sin(ra);
    position[i * 3 + 2] = Math.sin(dec);
    const [r, g, b] = bvToLinearRgb(records[i * 4 + 3]);
    color[i * 3] = r; color[i * 3 + 1] = g; color[i * 3 + 2] = b;
    flux[i] = starFlux(records[i * 4 + 2], zeroPoint);
  }
  return { count, position, color, flux };
}

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

  // --- background (full-screen triangle)
  const backgroundGeometry = new THREE.BufferGeometry();
  backgroundGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const backgroundMaterial = new THREE.ShaderMaterial({
    name: 'real-sky-background',
    uniforms: { uLum: { value: null }, uChroma: { value: null }, uSkyToScene: { value: skyMatrix }, uScale: { value: sceneScale }, uInvProjView: { value: new THREE.Matrix4() } },
    vertexShader: BACKGROUND_VERT, fragmentShader: BACKGROUND_FRAG, depthTest: false, depthWrite: false,
  });
  const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
  background.name = 'real-sky-background';
  background.frustumCulled = false;
  background.renderOrder = -1000;
  background.visible = false;
  const viewRotation = new THREE.Matrix4();
  const bufferSize = new THREE.Vector2();
  background.onBeforeRender = (renderer, _scene, camera) => {
    updateRotation();
    viewRotation.copy(camera.matrixWorldInverse).setPosition(0, 0, 0);
    backgroundMaterial.uniforms.uInvProjView.value.multiplyMatrices(camera.projectionMatrix, viewRotation).invert();
  };
  scene.add(background);

  // --- point stars
  const starMaterial = new THREE.ShaderMaterial({
    name: 'real-sky-stars',
    uniforms: { uSkyToScene: { value: skyMatrix }, uFluxToPixels: { value: 0 }, uSigma: { value: STAR_PSF_SIGMA_PX } },
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const starGeometry = new THREE.BufferGeometry();
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.name = 'real-sky-stars';
  stars.frustumCulled = false;
  stars.renderOrder = -999;
  stars.visible = false;
  stars.onBeforeRender = (renderer, _scene, camera) => {
    updateRotation();
    renderer.getDrawingBufferSize(bufferSize);
    const pixelRatio = renderer.getPixelRatio();
    starMaterial.uniforms.uSigma.value = STAR_PSF_SIGMA_PX * pixelRatio;
    starMaterial.uniforms.uFluxToPixels.value = (sceneScale * texelSolidAngle) / screenPixelSolidAngle(camera.fov, bufferSize.y);
  };
  scene.add(stars);

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

  loadSkyAssets({ runtime: createSkyRuntime(), zstd: loadZstd, mapAsset: SKY_MAP_ASSET, starsAsset: SKY_STARS_ASSET, baseURI, signal: controller.signal })
    .then((assets) => {
      if (disposed) return;
      state.errors = assets.errors;
      if (assets.luminance && assets.chroma) {
        backgroundMaterial.uniforms.uLum.value = cubeTextureFrom(THREE, assets.luminance);
        backgroundMaterial.uniforms.uChroma.value = cubeTextureFrom(THREE, assets.chroma);
        background.visible = true;
        state.map = true;
      }
      if (assets.stars) {
        const attributes = buildStarAttributes(assets.stars, calibration.zeroPoint);
        starGeometry.setAttribute('position', new THREE.BufferAttribute(attributes.position, 3));
        starGeometry.setAttribute('aColor', new THREE.BufferAttribute(attributes.color, 3));
        starGeometry.setAttribute('aFlux', new THREE.BufferAttribute(attributes.flux, 1));
        stars.visible = true;
        state.stars = true;
        state.starCount = attributes.count;
      }
      for (const [part, error] of Object.entries(assets.errors)) console.warn(`[Real sky] ${part} unavailable.`, error);
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
      scene.remove(background, stars);
      backgroundGeometry.dispose(); starGeometry.dispose();
      backgroundMaterial.uniforms.uLum.value?.dispose(); backgroundMaterial.uniforms.uChroma.value?.dispose();
      backgroundMaterial.dispose(); starMaterial.dispose();
      setNote(null);
    },
  };
  background.userData.realSky = api;
  return api;
}
