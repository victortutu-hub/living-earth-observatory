// LOT 15b: generic real-sky rendering layer, shared by Living Earth (src/earth/real-sky.js)
// and Living Himalaya (src/himalaya/himalaya-sky.js). Moved here from the Lot 15
// Living Earth module WITHOUT behaviour change: the Earth shaders below are the
// Lot 15 strings verbatim (tests/fixtures/earth-real-sky-golden.json pins their hashes).
//   * background: full-screen triangle (renderOrder -1000, no depth test or write)
//     sampling the Milky Way cube maps through one mat3 uSkyToScene (ICRS -> scene);
//   * point stars: THREE.Points at infinity (renderOrder -999, depth-tested, additive),
//     attributes = ICRS unit vector, luminance-normalised colour, flux in map units;
//   * assets: through the shared request runtime (sky-assets.js), no persistent cache.
// The caller owns the orientation matrix, the photometric uniforms and the status/notes.
import { SKY_DECODE_GLSL } from './sky-encoding.js';
import { starFlux } from './sky-photometry.js';
import { bvToLinearRgb } from './star-colors.js';
import { createSkyRuntime, loadSkyAssets } from './sky-assets.js';

export const SKY_BACKGROUND_VERT = `
uniform mat4 uInvProjView;
varying vec3 vDir;
void main() {
  vec4 p = uInvProjView * vec4(position.xy, 1.0, 1.0);
  vDir = p.xyz / p.w;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}`;

/** Lot 15 Living Earth background: decoded map radiance x uScale (no atmosphere). */
export const SKY_BACKGROUND_FRAG = `
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

/** Lot 15 Living Earth point stars (Gaussian PSF, energy = flux x uFluxToPixels). */
export const SKY_STAR_VERT = `
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

export const SKY_STAR_FRAG = `
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

export function loadSkyZstd() {
  return import('three/addons/libs/zstddec.module.js').then(async ({ ZSTDDecoder }) => {
    const decoder = new ZSTDDecoder();
    await decoder.init();
    return { decode: (data, size) => decoder.decode(data, size) };
  });
}

/** Six DataTextures per level -> CubeTexture with explicit mips (no GPU mip generation on log codes). */
export function cubeTextureFrom(THREE, cube) {
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

/**
 * Builds the two sky objects and adds them to `scene` (hidden until their data arrive).
 * @param {object} o
 * @param {string} o.name object/material name prefix ('real-sky' for Living Earth)
 * @param {object} o.skyMatrix THREE.Matrix3 shared by both materials (ICRS -> scene)
 * @param {object} o.background { fragmentShader, uniforms } (uLum, uChroma, uSkyToScene, uInvProjView are added)
 * @param {object} o.stars { vertexShader, fragmentShader, uniforms } (uSkyToScene is added)
 * @param {(renderer, camera) => void} [o.onBeforeBackground]
 * @param {(renderer, camera) => void} [o.onBeforeStars]
 */
export function createSkyLayer({
  THREE, scene, name, skyMatrix,
  background: backgroundSpec = {}, stars: starsSpec = {},
  onBeforeBackground = () => {}, onBeforeStars = () => {},
}) {
  // --- background (full-screen triangle)
  const backgroundGeometry = new THREE.BufferGeometry();
  backgroundGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const backgroundMaterial = new THREE.ShaderMaterial({
    name: `${name}-background`,
    uniforms: { uLum: { value: null }, uChroma: { value: null }, uSkyToScene: { value: skyMatrix }, ...(backgroundSpec.uniforms || {}), uInvProjView: { value: new THREE.Matrix4() } },
    vertexShader: SKY_BACKGROUND_VERT, fragmentShader: backgroundSpec.fragmentShader || SKY_BACKGROUND_FRAG, depthTest: false, depthWrite: false,
  });
  const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
  background.name = `${name}-background`;
  background.frustumCulled = false;
  background.renderOrder = -1000;
  background.visible = false;
  const viewRotation = new THREE.Matrix4();
  background.onBeforeRender = (renderer, _scene, camera) => {
    onBeforeBackground(renderer, camera);
    viewRotation.copy(camera.matrixWorldInverse).setPosition(0, 0, 0);
    backgroundMaterial.uniforms.uInvProjView.value.multiplyMatrices(camera.projectionMatrix, viewRotation).invert();
  };
  scene.add(background);

  // --- point stars
  const starMaterial = new THREE.ShaderMaterial({
    name: `${name}-stars`,
    uniforms: { uSkyToScene: { value: skyMatrix }, ...(starsSpec.uniforms || {}) },
    vertexShader: starsSpec.vertexShader || SKY_STAR_VERT, fragmentShader: starsSpec.fragmentShader || SKY_STAR_FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const starGeometry = new THREE.BufferGeometry();
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.name = `${name}-stars`;
  stars.frustumCulled = false;
  stars.renderOrder = -999;
  stars.visible = false;
  stars.onBeforeRender = (renderer, _scene, camera) => onBeforeStars(renderer, camera);
  scene.add(stars);

  let disposed = false;
  return {
    background, stars, backgroundMaterial, starMaterial,
    setMap(luminance, chroma) {
      backgroundMaterial.uniforms.uLum.value = cubeTextureFrom(THREE, luminance);
      backgroundMaterial.uniforms.uChroma.value = cubeTextureFrom(THREE, chroma);
      background.visible = true;
    },
    setStars(attributes) {
      starGeometry.setAttribute('position', new THREE.BufferAttribute(attributes.position, 3));
      starGeometry.setAttribute('aColor', new THREE.BufferAttribute(attributes.color, 3));
      starGeometry.setAttribute('aFlux', new THREE.BufferAttribute(attributes.flux, 1));
      stars.visible = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(background, stars);
      backgroundGeometry.dispose(); starGeometry.dispose();
      backgroundMaterial.uniforms.uLum.value?.dispose(); backgroundMaterial.uniforms.uChroma.value?.dispose();
      backgroundMaterial.dispose(); starMaterial.dispose();
    },
  };
}

/**
 * Loads the Milky Way cubes and the point stars through the shared request runtime
 * (no persistent cache) and hands them to the layer; each part fails independently.
 * @returns {Promise<{ map: boolean, stars: boolean, starCount: number, errors: object }>}
 */
export async function loadSkyLayer({ layer, mapAsset, starsAsset, zeroPoint, baseURI, signal, isDisposed, zstd = loadSkyZstd, runtime = createSkyRuntime() }) {
  const assets = await loadSkyAssets({ runtime, zstd, mapAsset, starsAsset, baseURI, signal });
  const result = { map: false, stars: false, starCount: 0, errors: assets.errors };
  if (isDisposed()) return result;
  if (assets.luminance && assets.chroma) { layer.setMap(assets.luminance, assets.chroma); result.map = true; }
  if (assets.stars) {
    const attributes = buildStarAttributes(assets.stars, zeroPoint);
    layer.setStars(attributes);
    result.stars = true;
    result.starCount = attributes.count;
  }
  return result;
}
