// LOT 15b: the real sky of Living Himalaya, seen from the selected summit.
//   * Rendering: the shared sky layer (src/core/sky/sky-layer.js) - full-screen background
//     first (no depth test or write), point stars at infinity, depth-tested against the
//     terrain; terrain, Sentinel-2, lines, markers and labels are drawn as before.
//   * Orientation: ICRS -> local horizon (N, W, Z) -> scene (north, -east, +y) for the
//     observer (src/core/sky/sky-frame.js skyToHorizonScene), refraction ignored.
//   * Brightness: src/core/sky/sky-atmosphere.js (night observed, twilight empirical fit,
//     day interpretive) times the exposure E, tone-mapped (Reinhard on luminance) in the sky
//     shaders only. The Milky Way and the stars keep the Lot 15 photometric scale.
//   * Assets: assets/sky through the shared request runtime, no persistent cache. Fallbacks:
//     no map -> atmosphere + point stars + note; no stars -> atmosphere + map + note;
//     neither -> the previous plain background + note. Below the geometric horizon the
//     previous plain background is kept (no sky there; the terrain covers it when loaded).
// The sky is background only: it does not light the terrain (lights unchanged).
import { SKY_MAP_ASSET } from '../config/sky-map.js';
import { SKY_STARS_ASSET } from '../config/sky-stars.js';
import { skyToHorizonScene } from '../core/sky/sky-frame.js';
import { SKY_DECODE_GLSL } from '../core/sky/sky-encoding.js';
import { STAR_PSF_SIGMA_PX, equatorialTexelSolidAngle, screenPixelSolidAngle } from '../core/sky/sky-photometry.js';
import { createSkyLayer, loadSkyLayer } from '../core/sky/sky-layer.js';
import { MAP_TO_CDM2, SKY_ATMOSPHERE_GLSL, SKY_MODEL, skyState } from '../core/sky/sky-atmosphere.js';

export const HIMALAYA_SKY_NOTES = Object.freeze({
  mapUnavailable: 'Milky Way map unavailable — point stars only.',
  starsUnavailable: 'Star catalogue unavailable — Milky Way background only.',
  unavailable: 'Real sky unavailable — plain dark background.',
  moon: 'Moonlight on the sky not modelled — with a bright Moon the Milky Way would be fainter than shown.',
});

const BACKGROUND_FRAG = `
uniform samplerCube uLum;
uniform samplerCube uChroma;
uniform mat3 uSkyToScene;
uniform float uMapOn;
uniform float uMapToCdm2;
uniform float uExposure;
uniform float uK;
uniform float uNightCdm2;
uniform float uDayAnchor;
uniform float uDayBlend;
uniform vec3 uDaySun;
uniform float uSunE;
uniform vec3 uBetaR;
uniform vec3 uBetaM;
uniform vec3 uGround;
varying vec3 vDir;
${SKY_DECODE_GLSL}
${SKY_ATMOSPHERE_GLSL}
void main() {
  vec3 dir = normalize(vDir);
  float cz = clamp(dir.y, 0.0, 1.0); // below the horizon: the horizon value (no sky there)
  vec3 night = vec3(uNightCdm2 * lumiDarkSkyFactor(cz, uK));
  vec3 atmosphere = night;
  if (uDayBlend < 1.0) {
    vec3 level = normalize(vec3(dir.x, cz, dir.z) + vec3(0.0, 1e-6, 0.0));
    vec3 day = max(lumiPreetham(level, uDaySun, uSunE, uBetaR, uBetaM) * uDayAnchor, vec3(1e-12));
    atmosphere = uDayBlend <= 0.0 ? day : exp(mix(log(day), log(night), uDayBlend));
  }
  vec3 map = vec3(0.0);
  if (uMapOn > 0.5 && dir.y > 0.0) {
    vec3 icrs = dir * uSkyToScene;
    vec3 value = lumiDecodeSky(textureCube(uLum, icrs).r, textureCube(uChroma, icrs).rg);
    map = value * uMapToCdm2 * pow(10.0, -0.4 * uK * lumiKastenYoung(cz));
  }
  vec3 L = (atmosphere + map) * uExposure;
  // Below the geometric horizon there is no sky: the previous plain background (clear colour).
  gl_FragColor = vec4(mix(uGround, L / (1.0 + dot(L, LUMI_LUMA)), smoothstep(-0.0015, 0.0015, dir.y)), 1.0);
  #include <colorspace_fragment>
}`;

const STAR_VERT = `
attribute vec3 aColor;
attribute float aFlux;
uniform mat3 uSkyToScene;
uniform float uFluxToPixels;
uniform float uSigma;
uniform float uK;
varying vec3 vColor;
varying float vEnergy;
${SKY_ATMOSPHERE_GLSL}
void main() {
  vec3 dir = uSkyToScene * position;
  vec4 view = viewMatrix * vec4(dir, 0.0);
  gl_Position = projectionMatrix * vec4(view.xyz * 50.0, 1.0);
  gl_Position.z = gl_Position.w * 0.9999; // at infinity: behind the terrain, depth-tested
  gl_PointSize = ceil(uSigma * 6.0) + 1.0;
  vColor = aColor;
  float cz = clamp(dir.y, 0.0, 1.0);
  vEnergy = dir.y > 0.0 ? aFlux * uFluxToPixels * pow(10.0, -0.4 * uK * lumiKastenYoung(cz)) : 0.0;
}`;

// Additive star on the tone-mapped background: T(Lb + e) - T(Lb), Lb = exposed reference background.
const STAR_FRAG = `
uniform float uSigma;
uniform float uBackground;
varying vec3 vColor;
varying float vEnergy;
void main() {
  float size = ceil(uSigma * 6.0) + 1.0;
  vec2 p = (gl_PointCoord - 0.5) * size;
  float e = vEnergy * exp(-dot(p, p) / (2.0 * uSigma * uSigma)) / (6.28318530718 * uSigma * uSigma);
  float increment = e / ((1.0 + uBackground) * (1.0 + uBackground + e));
  gl_FragColor = vec4(vColor * increment, 1.0);
  #include <colorspace_fragment>
}`;

/** Sky segment for the provenance bar. */
export function skyBarSegment(snapshot) {
  if (!snapshot || snapshot.status === 'loading') return 'Sky: loading…';
  if (!snapshot.map && !snapshot.stars) return 'Sky: unavailable (plain background)';
  const k = snapshot.k != null ? `, extinction k ${snapshot.k.toFixed(3)}` : '';
  switch (snapshot.regime) {
    case 'day': return 'Sky: day — interpretive (Preetham model, non-photometric)';
    case 'transition': return 'Sky: Sun 0…−5° — interpretive transition (day model ↔ twilight fit)';
    case 'twilight': return `Sky: twilight — observed empirical fit (Patat et al. 2006, Paranal, extrapolated to altitude)${k}`;
    default: {
      const parts = snapshot.map && snapshot.stars ? 'NASA SVS Milky Way + HYG stars' : snapshot.stars ? 'HYG stars; Milky Way map unavailable' : 'NASA SVS Milky Way; star catalogue unavailable';
      return `Sky: night — observed (${parts}${k})`;
    }
  }
}

export function createHimalayaSky({ THREE, scene, groundColor = 0x03060d, baseURI = document.baseURI }) {
  const controller = new AbortController();
  const skyMatrix = new THREE.Matrix3();
  const texelSolidAngle = equatorialTexelSolidAngle(SKY_MAP_ASSET.background.width, SKY_MAP_ASSET.background.height);
  const state = { status: 'loading', map: false, stars: false, starCount: 0, errors: {}, note: null, source: null, observer: null, model: null };
  let disposed = false;
  const bufferSize = new THREE.Vector2();
  const layer = createSkyLayer({
    THREE, scene, name: 'himalaya-sky', skyMatrix,
    background: {
      fragmentShader: BACKGROUND_FRAG,
      uniforms: {
        uMapOn: { value: 0 }, uMapToCdm2: { value: MAP_TO_CDM2 }, uExposure: { value: 1 }, uK: { value: 0 },
        uNightCdm2: { value: 0 }, uDayAnchor: { value: 0 }, uDayBlend: { value: 1 },
        uDaySun: { value: new THREE.Vector3(0, 1, 0) }, uSunE: { value: 0 }, uBetaR: { value: new THREE.Vector3() }, uBetaM: { value: new THREE.Vector3() },
        uGround: { value: new THREE.Color(groundColor) }, // linear (colour management), written back as the clear colour
      },
    },
    stars: {
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: { uFluxToPixels: { value: 0 }, uSigma: { value: STAR_PSF_SIGMA_PX }, uK: { value: 0 }, uBackground: { value: 0 } },
    },
    onBeforeStars: (renderer, camera) => {
      renderer.getDrawingBufferSize(bufferSize);
      const u = layer.starMaterial.uniforms;
      u.uSigma.value = STAR_PSF_SIGMA_PX * renderer.getPixelRatio();
      // Lot 15 scale: flux (map units x texel solid angle) -> cd/m^2 per screen pixel, times the exposure.
      u.uFluxToPixels.value = (MAP_TO_CDM2 * texelSolidAngle * (state.model?.exposure ?? 0)) / screenPixelSolidAngle(camera.fov, bufferSize.y);
    },
  });
  const { background, stars, backgroundMaterial, starMaterial } = layer;

  function applyModel() {
    const m = state.model;
    if (!m) return;
    const b = backgroundMaterial.uniforms;
    b.uExposure.value = m.exposure; b.uK.value = m.k; b.uNightCdm2.value = m.nightCdm2;
    b.uDayAnchor.value = m.dayAnchor; b.uDayBlend.value = m.dayBlend;
    b.uDaySun.value.set(...m.day.sunDir); b.uSunE.value = m.day.sunE;
    b.uBetaR.value.set(...m.day.betaR); b.uBetaM.value.set(...m.day.betaM);
    starMaterial.uniforms.uK.value = m.k;
    starMaterial.uniforms.uBackground.value = m.exposure * m.referenceCdm2;
  }

  /**
   * @param {object} o date, latDeg, lonDeg, heightM, basis (projection localBasis), Astronomy (or null),
   *   sun { azimuthDeg, altitudeDeg }, eMax (optional, for the E_max comparison captures)
   */
  function setObserver({ date, latDeg, lonDeg, heightM, basis, Astronomy = null, sun, eMax = SKY_MODEL.exposure.eMax }) {
    const frame = skyToHorizonScene({ date, latDeg, lonDeg, heightM, basis, Astronomy });
    skyMatrix.set(...frame.matrix[0], ...frame.matrix[1], ...frame.matrix[2]);
    state.source = frame.source;
    state.observer = { date: date.toISOString(), latDeg, lonDeg, heightM };
    state.model = skyState({ sunAzimuthDeg: sun.azimuthDeg, sunAltitudeDeg: sun.altitudeDeg, heightM, basis, eMax });
    applyModel();
  }

  function publish() {
    state.status = state.map && state.stars ? 'MAP + STARS' : state.stars ? 'STARS ONLY' : state.map ? 'MAP ONLY' : 'UNAVAILABLE';
    state.note = state.map && state.stars ? null : state.stars ? HIMALAYA_SKY_NOTES.mapUnavailable : state.map ? HIMALAYA_SKY_NOTES.starsUnavailable : HIMALAYA_SKY_NOTES.unavailable;
    // The atmosphere needs no asset, but with nothing loaded the previous plain background stays.
    background.visible = state.map || state.stars;
    backgroundMaterial.uniforms.uMapOn.value = state.map ? 1 : 0;
  }

  const ready = loadSkyLayer({ layer, mapAsset: SKY_MAP_ASSET, starsAsset: SKY_STARS_ASSET, zeroPoint: SKY_MAP_ASSET.calibration.zeroPoint, baseURI, signal: controller.signal, isDisposed: () => disposed })
    .then((loaded) => {
      if (disposed) return;
      Object.assign(state, { map: loaded.map, stars: loaded.stars, starCount: loaded.starCount, errors: loaded.errors });
      for (const [part, error] of Object.entries(loaded.errors)) console.warn(`[Living Himalaya sky] ${part} unavailable.`, error);
      publish();
    })
    .catch((error) => { if (!disposed) { state.errors.load = error?.message || String(error); publish(); } });

  return {
    background, stars, ready, setObserver,
    snapshot: () => {
      const m = state.model;
      return {
        status: state.status, map: state.map, stars: state.stars, starCount: state.starCount, note: state.note, errors: { ...state.errors },
        source: state.source, observer: state.observer, matrix: skyMatrix.toArray(), backgroundVisible: background.visible, starsVisible: stars.visible,
        regime: m?.regime ?? null, zeta: m ? +m.zeta.toFixed(3) : null, k: m ? +m.k.toFixed(4) : null,
        exposure: m?.exposure ?? null, eMax: m?.eMax ?? null, referenceCdm2: m?.referenceCdm2 ?? null,
        nightCdm2: m?.nightCdm2 ?? null, dayBlend: m?.dayBlend ?? null, mapToCdm2: backgroundMaterial.uniforms.uMapToCdm2.value,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort(new DOMException('Living Himalaya sky disposed', 'AbortError'));
      layer.dispose();
    },
  };
}

/** LOT 18: displayed reference sky (tone-mapped E * L_ref) above which the free text gets the strong veil. */
export const BRIGHT_SKY_DISPLAY = 0.03;
export function isBrightSky(snapshot) {
  if (!snapshot || !snapshot.backgroundVisible || snapshot.exposure == null || snapshot.referenceCdm2 == null) return false;
  const lb = snapshot.exposure * snapshot.referenceCdm2;
  return lb / (1 + lb) > BRIGHT_SKY_DISPLAY;
}

/** Sources & attribution entry for the sky (credit + every declared model choice). */
export function skyAttribution(snapshot = null) {
  const e = SKY_MODEL.exposure;
  const k = snapshot?.k != null ? snapshot.k.toFixed(3) : '0.07–0.10';
  return {
    id: 'sky',
    title: 'Sky (night, twilight, day)',
    text: 'Milky Way: NASA/Goddard Space Flight Center Scientific Visualization Studio, Deep Star Maps 2020 (Gaia DR2: ESA/Gaia/DPAC). Stars: HYG database v4.4 (Hipparcos, CC BY-SA 4.0). Day model: Preetham et al. 1999 via three.js Sky.js (MIT).',
    note: [
      'Night: observed — the NASA SVS map and the HYG stars on the Living Earth photometric scale (not amplified), dimmed by atmospheric extinction (Kasten & Young 1989 airmass), plus the dark-sky glow of Patat 2003 (V 21.6 mag/arcsec² at the zenith, minus the map’s own starlight, brighter towards the horizon).',
      `Extinction: k = ${k} mag/airmass at this height — Buton et al. 2013 (Mauna Kea, 5500 Å) with the Rayleigh part scaled by the ISA pressure.`,
      'Twilight (Sun −5° to −16°): observed — the empirical V-band zenith fit of Patat, Ugolnikov & Postylyakov 2006 (Cerro Paranal, 2635 m), applied unchanged at 5–9 km (extrapolated to altitude); colour and the glow towards the Sun not modelled.',
      'Sun 0° to −5°: interpretive transition between the day model and the twilight fit.',
      'Day: interpretive — Preetham sky with the Rayleigh term scaled by the pressure at the summit height; absolute brightness not photometric.',
      `Exposure: display target ${e.target}, adaptation limit E_max = ${e.eMax} — aesthetic choice (mid grey at 45° above the horizon opposite the Sun, E_max per cd/m²); tone curve on the sky only — terrain, image, lines and labels are unchanged. The sky does not light the terrain.`,
      'Milky Way: colours as recorded by a camera; the dark-adapted eye sees little colour.',
      'Directions are geometric: atmospheric refraction ignored.',
      HIMALAYA_SKY_NOTES.moon,
      snapshot?.note || null,
    ].filter(Boolean).join(' '),
  };
}
