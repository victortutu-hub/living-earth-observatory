import { loadAstronomyEngine } from './astronomy-runtime.js';
import { composeProvenanceStatus } from './temporal-provenance.js';
import { MOON_COLOR_ASSET } from '../config/moon-color.js';
import { MOON_NORMAL_ASSET } from '../config/moon-normal.js';
import { createNoteFlash, earthshineViewNoteText, moonLitFraction, nextEarthshineWindow } from './earthshine-window.js';
import { MOON_PREWARM_MOBILE_MAX_PX, createMoonPrewarm, loadTextureBitmapFirst, moonPrewarmDecision, moonPrewarmSkippedMessage } from './moon-prewarm.js';
import { EARTH_GEOMETRIC_ALBEDO, EARTHSHINE_VIEW_EV, EARTHSHINE_VIEW_MAX_LIT_FRACTION, MOON_SENSOR_WHITE, earthPhaseAngleFromElongationCos, earthshineRatio, earthshineViewButtonState, enforceEarthshineExposure, requestEarthshineExposure, stopsBelowSun } from './earthshine.js';
const AU_KM = 149597870.7;
const MEAN_MOON_DISTANCE_KM = 384400;

function raDecToUnit(THREE, raHours, decDeg) {
    const ra = raHours * Math.PI / 12;
    const dec = decDeg * Math.PI / 180;
    return new THREE.Vector3(
        Math.cos(dec) * Math.cos(ra),
        Math.sin(dec),
        Math.cos(dec) * Math.sin(ra)
    ).normalize();
}

function normalizeLongitude(degrees) {
    return ((degrees + 540) % 360) - 180;
}

function formatMoonDistance(km) {
    if (!Number.isFinite(km)) return 'unknown distance';
    return `${Math.round(km / 1000)}k km`;
}

function updateMoonStatus(state) {
    const status = document.getElementById('moonStatus');
    if (!status) return;
    status.dataset.state = state.visible ? 'on' : state.source === 'unavailable' ? 'error' : 'pending';
    if (state.source === 'unavailable') {
        status.textContent = 'Moon: Astronomy Engine unavailable';
        return;
    }
    if (state.source === 'retrying') {
        status.textContent = 'Moon: retrying Astronomy Engine...';
        return;
    }
    if (!state.visible) {
        status.textContent = 'Moon: calculating Astronomy Engine position...';
        return;
    }
    const phase = Number.isFinite(state.phaseFraction)
        ? `${Math.round(state.phaseFraction * 100)}% lit from Earth` // LOT 33: geocentric phase
        : 'phase unknown';
    const composed = composeProvenanceStatus('astronomy', `Moon: ${phase} · ${formatMoonDistance(state.distanceKm)}`, {
        extraTitle: `Moon position and phase from ${state.source}`,
    });
    status.textContent = composed.message;
    status.title = composed.title;
}

// LOT 30: the Moon textures come from the NASA SVS CGI Moon Kit (https://svs.gsfc.nasa.gov/4720;
// "Please give credit for this item to: NASA's Scientific Visualization Studio"), built offline into
// assets/moon/ by tools/build-moon-color.mjs (LROC WAC colour 4096x2048, re-encoded only) and
// tools/build-moon-normal.mjs (normal map reconstructed from LOLA topography, vertical exaggeration 1x).
// The older local files of the same kit stay: LROC WAC 1024x512 colour (loaded only as the labelled
// fallback when the 4K colour map does not load) and LOLA elevation 1024x512 (displacement + bump).
// The NASA server allows no cross-origin fetch, so every Moon file is local.
const MOON_TEXTURE_NASA_LOCAL_PATH = 'assets/moon-lroc-color-1k-1024x512.jpg';
const MOON_DISPLACEMENT_LOCAL_PATH = 'assets/moon-ldem-elevation-1024x512.jpg';
export const MOON_TEXTURE_CREDIT_LABEL = "NASA SVS CGI Moon Kit — credit: NASA's Scientific Visualization Studio (NASA media guidelines)";

/** LOT 30: rows of the Moon details card that describe the active textures (no value of their own). */
export function describeMoonTextures(state) {
    const shading = state.normalAvailable === false
        ? 'Normal map unavailable (did not load); LOLA displacement only'
        : `Normal map ${MOON_NORMAL_ASSET.width}×${MOON_NORMAL_ASSET.height} reconstructed from LOLA topography (LDEM 16 px/deg), ${MOON_NORMAL_ASSET.scale.kmPerPixelNS} km/px, vertical exaggeration ${MOON_NORMAL_ASSET.scale.verticalExaggeration}×`;
    const texture = state.textureSource === 'nasa-1k-fallback'
        ? 'NASA LROC 1K (fallback): LROC WAC colour 1024×512, local; the 4K colour map did not load'
        : `LROC WAC colour ${MOON_COLOR_ASSET.width}×${MOON_COLOR_ASSET.height} · observed (SVS: optimized for aesthetics, not science)`;
    return [
        { label: 'Texture', value: texture },
        { label: 'Relief shading', value: shading },
        { label: 'Source', value: MOON_TEXTURE_CREDIT_LABEL },
    ];
}

function handleTextureLoadError(label, url) {
    return error => {
        console.warn(`[Moon] ${label} failed to load from ${url} (CORS or network). Material continues without it.`, error);
    };
}

// Converteste coordonate selenografice (longitudine/latitudine, grade) in
// directia locala (spatiul obiectului) corespunzatoare pe sfera Lunii, folosind
// EXACT aceeasi parametrizare UV pe care Three.js SphereGeometry o foloseste
// intern (phi=2*PI*u, theta=PI*v). La (lon=0, lat=0) rezultatul e (1,0,0) local -
// verificat manual, corespunde centrului texturii echirectangulare (conventia
// "centered on 0 deg longitude" folosita de hartile NASA SVS). LOT 30: verificat
// vizual pe harta LROC 4K - Tycho cade la lon -11.4, lat -43.3 (tmp/lot30/shots/moon).
// MOON_LONGITUDE_SIGN ramane izolat ca sa poata fi inversat cu o singura schimbare.
const MOON_LONGITUDE_SIGN = 1;
export function localDirForSelenographic(THREE, lonDeg, latDeg, target = new THREE.Vector3()) {
    const u = 0.5 + (MOON_LONGITUDE_SIGN * lonDeg) / 360;
    const v = 0.5 - latDeg / 180;
    const phi = 2 * Math.PI * u;
    const theta = Math.PI * v;
    return target.set(
        -Math.cos(phi) * Math.sin(theta),
        Math.cos(theta),
        Math.sin(phi) * Math.sin(theta)
    );
}

// Construieste quaternionul care roteste sfera Lunii astfel incat directia
// localForward (in spatiul local/obiect) sa se alinieze cu worldForward (in
// spatiul lumii), pastrand polul sferei (local +Y) cat mai aproape de
// worldUpHint. Echivalent cu un "lookAt" generalizat pe o axa arbitrara.
function computeAlignedQuaternion(THREE, localForward, worldForward, worldUpHint) {
    const localUpHint = new THREE.Vector3(0, 1, 0);
    let localRight = new THREE.Vector3().crossVectors(localUpHint, localForward);
    if (localRight.lengthSq() < 1e-8) localRight.set(1, 0, 0);
    localRight.normalize();
    const localUp = new THREE.Vector3().crossVectors(localForward, localRight).normalize();

    let worldRight = new THREE.Vector3().crossVectors(worldUpHint, worldForward);
    if (worldRight.lengthSq() < 1e-8) worldRight.set(1, 0, 0);
    worldRight.normalize();
    const worldUp = new THREE.Vector3().crossVectors(worldForward, worldRight).normalize();

    const localBasis = new THREE.Matrix4().makeBasis(localRight, localUp, localForward);
    const worldBasis = new THREE.Matrix4().makeBasis(worldRight, worldUp, worldForward);
    const rotationMatrix = worldBasis.multiply(localBasis.invert());
    return new THREE.Quaternion().setFromRotationMatrix(rotationMatrix);
}

// LOT 30: LROC WAC 1024x512 (local), only as the labelled fallback of the 4K colour map.
// LOT 32: plain TextureLoader (the previous path), with a settle callback for the GPU warm-up.
function createMoonTextureNasa(THREE, onSettled = () => {}) {
    const loader = new THREE.TextureLoader();
    const onError = handleTextureLoadError('LROC 1K fallback texture', MOON_TEXTURE_NASA_LOCAL_PATH);
    const texture = loader.load(
        MOON_TEXTURE_NASA_LOCAL_PATH,
        () => onSettled(true), undefined,
        (error) => { onError(error); onSettled(false); }
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

// Harta de elevatie reala LOLA - folosita atat pentru displacement (deformare
// geometrica reala a sferei) cat si ca bump fin suplimentar, exact ca la
// Pamant. Returneaza null daca nu exista sursa locala configurata (CDN-ul
// NASA are CORS blocat pentru origini externe - vezi comentariul de mai sus).
// LOT 32: decoded off the main thread (moon-prewarm.js); anisotropy stays at the default, as before.
function createMoonDisplacementTexture(THREE, isActive) {
    if (!MOON_DISPLACEMENT_LOCAL_PATH) return null;
    return loadTextureBitmapFirst({
        THREE, file: MOON_DISPLACEMENT_LOCAL_PATH, colorSpace: THREE.NoColorSpace, anisotropy: 1, isActive,
        onError: handleTextureLoadError('Displacement map', MOON_DISPLACEMENT_LOCAL_PATH),
    });
}

// LOT 30: one local Moon asset (NASA SVS set), with load / error callbacks.
// LOT 32: decoded off the main thread when possible; onError only if the previous <img> path fails too.
function loadMoonAsset(THREE, file, colorSpace, onError, onLoad, isActive) {
    return loadTextureBitmapFirst({ THREE, file, colorSpace, anisotropy: 4, onError, onLoad, isActive });
}

// LOT 31: the Moon is lit only by the real Sun and the physical earthshine (earthshine.js), not by the
// scene lights (the cool fill opposite the Sun and the ambient light stay for the Earth only). The
// Lambert material keeps its colour map, LOLA normal map, bump and displacement, the fallback swap and
// the pipeline tone mapping; onBeforeCompile replaces only the light accumulation with two directional
// terms read from uniforms (view space, set in onBeforeRender from the live sunLight), with the same
// formula three.js uses for a directional light (irradiance = saturate(N.L) * colour, times
// BRDF_Lambert). uMoonExposure multiplies the outgoing light before tone mapping (1 = none).
export const MOON_LIGHTING_CHUNKS = Object.freeze({
    begin: '#include <lights_fragment_begin>',
    maps: '#include <lights_fragment_maps>',
    end: '#include <lights_fragment_end>',
    output: '#include <opaque_fragment>',
});
export function patchMoonLightingShader(shader, uniforms) {
    for (const [key, chunk] of Object.entries(MOON_LIGHTING_CHUNKS)) {
        if (!shader.fragmentShader.includes(chunk)) throw new Error(`Moon lighting patch: ${key} chunk not found (three.js changed?)`);
    }
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec3 uMoonSunDir;\nuniform vec3 uMoonSunColor;\nuniform vec3 uMoonEarthDir;\nuniform float uMoonEarthshine;\nuniform float uMoonExposure;\nuniform float uMoonSensorWhite;\nvoid main() {')
        .replace(MOON_LIGHTING_CHUNKS.begin, [
            '// LOT 31: Sun + physical earthshine only (no ambient, no fill lights).',
            'float moonSunNL = saturate( dot( normal, uMoonSunDir ) );',
            'reflectedLight.directDiffuse += moonSunNL * uMoonSunColor * BRDF_Lambert( material.diffuseColor );',
            'float moonEarthNL = saturate( dot( normal, uMoonEarthDir ) );',
            'reflectedLight.directDiffuse += moonEarthNL * uMoonEarthshine * uMoonSunColor * BRDF_Lambert( material.diffuseColor );',
        ].join('\n'))
        .replace(MOON_LIGHTING_CHUNKS.maps, '')
        .replace(MOON_LIGHTING_CHUNKS.end, '')
        // LOT 31 ETAPA 2b: with an exposure above x1 the output is clipped at sensor white before the tone
        // mapping and the bloom (a photograph clips; the bloom then sees a white object, not a Sun).
        .replace(MOON_LIGHTING_CHUNKS.output, `outgoingLight *= uMoonExposure;\nif ( uMoonExposure > 1.0 ) outgoingLight = min( outgoingLight, vec3( uMoonSensorWhite ) );\n${MOON_LIGHTING_CHUNKS.output}`);
    return shader;
}

function createMoonHaloTexture(THREE) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const center = canvas.width / 2;
    const halo = ctx.createRadialGradient(center, center, 18, center, center, 126);
    halo.addColorStop(0, 'rgba(255,246,222,0.22)');
    halo.addColorStop(0.24, 'rgba(220,232,255,0.08)');
    halo.addColorStop(0.62, 'rgba(120,170,255,0.018)');
    halo.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export function createMoonSystem({
    THREE,
    scene,
    sunLight,
    lonLatToVec3,
    getDate = () => new Date(),
    refreshMs = 60000,
    // LOT 32: GPU warm-up at idle (moon-prewarm.js); without a renderer there is no warm-up (previous behaviour).
    renderer = null,
    camera = null,
    getRenderTarget = () => null,
    // LOT 32: warm-up only when the device memory allows it (moonPrewarmDecision).
    prewarmDecision = moonPrewarmDecision({
        deviceMemory: typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined,
        innerWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
        mobileMaxPx: MOON_PREWARM_MOBILE_MAX_PX,
    })
}) {
    const MOON_SCENE_DISTANCE = 13.5;
    const MOON_APPARENT_SIZE = 0.032;
    const MOON_MIN_SIZE = 0.2;
    const MOON_MAX_SIZE = 0.52;
    const EARTH_OCCLUSION_RADIUS = 2.03;
    const state = {
        visible: false,
        source: 'pending',
        sublunarLon: 0,
        sublunarLat: 0,
        distanceKm: MEAN_MOON_DISTANCE_KM,
        phaseFraction: 0,
        textureSource: 'nasa-svs',
        normalAvailable: null,
        librationElon: 0,
        librationElat: 0,
        orientationSource: 'pending',
        moonRollOffsetDeg: 0,
        sunWorldDir: new THREE.Vector3(1, 0, 0),
        // LOT 31: physical earthshine (earthshine.js), updated with the Moon position.
        earthshine: { ratio: 0, stops: Infinity, earthPhaseAngleDeg: null, albedo: EARTH_GEOMETRIC_ALBEDO, distanceKm: MEAN_MOON_DISTANCE_KM },
        exposureEv: 0,
        earthshineViewNote: null, // LOT 31 ETAPA 2b: why the view is unavailable / was turned off
        // LOT 33: next window with the view available ({ start, end, openNow, from }), from the displayed time
        earthshineWindow: null
    };
    let moonMat = null;
    let moonTextureFallback = null; // LROC 1K, created only if the 4K colour map fails
    let stopped = false; // LOT 32: a stopped system ignores late texture results and cancels its warm-up
    const isActive = () => !stopped;
    let settleColor;
    const colorReady = new Promise((resolve) => { settleColor = resolve; });
    // LOT 30: colour = NASA SVS LROC WAC 4K; if it does not load, the local LROC 1K map, labelled.
    const { texture: moonTextureColor, ready: colorLoaded } = loadMoonAsset(THREE, MOON_COLOR_ASSET.file, THREE.SRGBColorSpace, (error) => {
        console.warn(`[Moon] NASA SVS colour map ${MOON_COLOR_ASSET.file} unavailable; using the local LROC 1K map (fallback).`, error);
        moonTextureFallback = moonTextureFallback || createMoonTextureNasa(THREE, settleColor);
        state.textureSource = 'nasa-1k-fallback';
        if (moonMat) {
            moonMat.map = moonTextureFallback;
            moonMat.userData.textureSource = MOON_TEXTURE_NASA_LOCAL_PATH;
            moonMat.needsUpdate = true;
        }
    }, undefined, isActive);
    colorLoaded.then((ok) => { if (ok || !isActive()) settleColor(ok); }); // on failure the 1K fallback settles it
    // Normal map reconstructed from LOLA topography (1x); without it, displacement + bump only.
    const { texture: moonNormalTexture, ready: normalReady } = loadMoonAsset(THREE, MOON_NORMAL_ASSET.file, THREE.NoColorSpace, (error) => {
        console.warn(`[Moon] NASA SVS normal map ${MOON_NORMAL_ASSET.file} unavailable; material continues without it.`, error);
        state.normalAvailable = false;
        if (moonMat) { moonMat.normalMap = null; moonMat.needsUpdate = true; }
    }, () => { state.normalAvailable = true; }, isActive);
    const displacement = createMoonDisplacementTexture(THREE, isActive); // null pana adaugi assetul local
    const moonDisplacementTexture = displacement?.texture || null;
    // Sfera reala (nu billboard plat) - textura echirectangulara se infasoara
    // corect doar pe o sfera. Raza 0.5 => diametru 1, ca sa pastram identic
    // conventia veche de scalare (scale.setScalar(x) = diametrul aparent).
    // Segmente marite (256x192, fata de 64x48) pentru ca displacement-ul real
    // sa aiba suficiente vertecsi ca sa arate neted la zoom apropiat, exact
    // ca la relieful Pamantului.
    const moonSphereGeometry = new THREE.SphereGeometry(0.5, 256, 192);
    // Geometrie plata separata, doar pentru haloul decorativ (billboard aditiv
    // care trebuie sa priveasca mereu camera).
    const moonBillboardGeometry = new THREE.PlaneGeometry(1, 1, 2, 2);
    // MeshLambertMaterial (difuz, fara specular) - Luna nu are atmosfera care
    // sa produca luciu. LOT 31: iluminarea e doar Soarele real + earthshine-ul
    // fizic (patchMoonLightingShader); fara ambient, fara emissive, fara fill.
    // displacementMap/bumpMap adaugate DOAR daca exista un asset local valid
    // (moonDisplacementTexture non-null) - CORS-ul NASA blocheaza incarcarea
    // directa, deci pana la adaugarea assetului local, Luna ramane cu
    // culoare + normal map, fara deformare geometrica reala.
    const moonMatParams = {
        map: moonTextureColor,
        color: 0xffffff,
        normalMap: moonNormalTexture,
        // 1: the normals are computed from the measured slopes (vertical exaggeration 1x, moon-normal.js).
        normalScale: new THREE.Vector2(1, 1)
    };
    if (moonDisplacementTexture) {
        moonMatParams.bumpMap = moonDisplacementTexture;
        moonMatParams.bumpScale = 0.015;
        moonMatParams.displacementMap = moonDisplacementTexture;
        moonMatParams.displacementScale = 0.035;
        moonMatParams.displacementBias = -0.017;
    }
    moonMat = new THREE.MeshLambertMaterial(moonMatParams);
    const moonLightUniforms = {
        uMoonSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uMoonSunColor: { value: new THREE.Color(0, 0, 0) },
        uMoonEarthDir: { value: new THREE.Vector3(-1, 0, 0) },
        uMoonEarthshine: { value: 0 },
        uMoonExposure: { value: 1 },
        uMoonSensorWhite: { value: MOON_SENSOR_WHITE },
    };
    moonMat.onBeforeCompile = (shader) => patchMoonLightingShader(shader, moonLightUniforms);
    moonMat.customProgramCacheKey = () => 'lumi-moon-physical-lighting-lot31';
    moonMat.userData.lighting = 'sun + physical earthshine (LOT 31)';
    moonMat.userData.textureSource = MOON_COLOR_ASSET.file;
    moonMat.userData.normalSource = MOON_NORMAL_ASSET.file;
    moonMat.userData.displacementSource = MOON_DISPLACEMENT_LOCAL_PATH;
    const moon = new THREE.Mesh(moonSphereGeometry, moonMat);
    moon.name = 'astronomical-moon';
    moon.visible = false;
    moon.renderOrder = 6;
    moon.userData.specialId = 'moon';
    // LOT 31: light uniforms from the live sunLight and the camera that renders this frame.
    const sunWorld = new THREE.Vector3(); const targetWorld = new THREE.Vector3(); const moonWorld = new THREE.Vector3();
    moon.onBeforeRender = (renderer, renderScene, renderCamera) => {
        sunWorld.setFromMatrixPosition(sunLight.matrixWorld);
        targetWorld.setFromMatrixPosition(sunLight.target.matrixWorld);
        moonLightUniforms.uMoonSunDir.value.copy(sunWorld).sub(targetWorld).normalize().transformDirection(renderCamera.matrixWorldInverse);
        moonLightUniforms.uMoonSunColor.value.copy(sunLight.color).multiplyScalar(sunLight.intensity);
        moonWorld.setFromMatrixPosition(moon.matrixWorld);
        moonLightUniforms.uMoonEarthDir.value.copy(moonWorld).negate().normalize().transformDirection(renderCamera.matrixWorldInverse); // the Earth is at the origin
        moonLightUniforms.uMoonEarthshine.value = state.earthshine.ratio;
    };
    scene.add(moon);

    // Offset artistic de roll, in grade, aplicat DUPA orientarea fizica reala
    // (libration + pol real). Default 0 - baza e mereu 100% fizica. Util doar
    // pentru compozitii cinematice/reel unde regia cere o rotatie mica a discului
    // (recomandat maxim +/-5-8 grade, ca sa nu se abata vizibil de la realitate).
    // finalRoll = orientareaFizicaReala + moonRollOffsetDeg.
    function setMoonRollOffset(deg) {
        state.moonRollOffsetDeg = Number.isFinite(deg) ? deg : 0;
    }

    const moonHalo = new THREE.Mesh(moonBillboardGeometry.clone(), new THREE.MeshBasicMaterial({
        map: createMoonHaloTexture(THREE),
        color: 0xd8e4ff,
        transparent: true,
        opacity: 0.04,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
    }));
    moonHalo.name = 'astronomical-moon-halo';
    moonHalo.visible = false;
    moonHalo.renderOrder = 5;
    scene.add(moonHalo);

    // LOT 32: upload the Moon textures and compile its program at idle, after the page load, so the first view
    // of the Moon (which depends on the date and the camera) no longer stalls a frame. Nothing visual changes.
    // Skipped on low-memory devices (moonPrewarmDecision): the Moon then uploads on its first view, as before.
    if (renderer && camera && !prewarmDecision.warm) console.info(moonPrewarmSkippedMessage(prewarmDecision.reason));
    const prewarm = renderer && camera && prewarmDecision.warm ? createMoonPrewarm({
        renderer, scene, camera, getRenderTarget,
        objects: [moon, moonHalo],
        ready: Promise.all([colorReady, normalReady, displacement?.ready]),
        getTextures: () => [moonMat.map, moonMat.normalMap, moonMat.bumpMap, moonMat.displacementMap, moonHalo.material.map],
    }) : null;
    prewarm?.start();

    let astronomyObserver = null;
    let intervalId = null;

    // LOT 31 ETAPA 2: "Earthshine view" = a real exposure change of the whole Moon (+10 EV: the
    // earthshine side becomes visible, the lit side clips at sensor white, as in photographs). Only the
    // Moon material (uMoonExposure); the Earth is not affected. ETAPA 2b: available only up to
    // EARTHSHINE_VIEW_MAX_LIT_FRACTION (earthshine.js); refused above it, turned off when the phase crosses it.
    function updateEarthshineViewButton() {
        const button = typeof document !== 'undefined' ? document.getElementById('earthshineViewBtn') : null;
        if (!button) return;
        // LOT 33: aria-disabled (still clickable), one-line label (earthshine.js: earthshineViewButtonState).
        const view = earthshineViewButtonState({ litFraction: state.phaseFraction, stops: state.earthshine.stops, exposureEv: state.exposureEv });
        button.disabled = false;
        button.setAttribute('aria-disabled', String(view.ariaDisabled));
        button.setAttribute('aria-pressed', String(view.pressed));
        button.textContent = view.text;
        button.title = view.title;
        // LOT 33: the visible line under the button (the reason and the next window; no hover needed).
        const note = document.getElementById('earthshineViewNote');
        if (note) {
            const w = state.earthshineWindow;
            note.textContent = earthshineViewNoteText({ available: !view.ariaDisabled, window: w, from: w ? new Date(w.from) : null, astronomy: state.source === 'astronomy-engine' ? 'ok' : state.source === 'retrying' ? 'failed' : 'pending' });
        }
    }
    /** Returns true when the exposure is applied; false when the Earthshine view is refused at this phase. */
    function setMoonExposureEv(ev = 0) {
        const r = requestEarthshineExposure({ wantedEv: ev, litFraction: state.phaseFraction, stops: state.earthshine.stops });
        state.exposureEv = r.ev;
        state.earthshineViewNote = r.note;
        moonLightUniforms.uMoonExposure.value = 2 ** state.exposureEv;
        updateEarthshineViewButton();
        return r.applied;
    }
    // LOT 33: a tap on the disabled (aria-disabled) button changes nothing; it only highlights the note briefly.
    const noteFlash = createNoteFlash();
    function toggleEarthshineView() {
        const view = earthshineViewButtonState({ litFraction: state.phaseFraction, stops: state.earthshine.stops, exposureEv: state.exposureEv });
        if (view.ariaDisabled) {
            noteFlash.flash(typeof document !== 'undefined' ? document.getElementById('earthshineViewNote') : null);
            return false;
        }
        return setMoonExposureEv(state.exposureEv > 0 ? 0 : EARTHSHINE_VIEW_EV);
    }
    /** After a phase change (time scrub / live time): above the threshold the view turns itself off. */
    function enforceEarthshineViewThreshold() {
        const r = enforceEarthshineExposure({ ev: state.exposureEv, litFraction: state.phaseFraction, stops: state.earthshine.stops });
        if (r.turnedOff) {
            state.exposureEv = 0;
            moonLightUniforms.uMoonExposure.value = 1;
            state.earthshineViewNote = r.note;
            console.info(`[Moon] ${r.note}`);
        }
        updateEarthshineViewButton();
    }

    async function updateMoonPosition(now = getDate()) {
        const Astronomy = await loadAstronomyEngine();
        if (!Astronomy) {
            moon.visible = false;
            moonHalo.visible = false;
            state.visible = false;
            state.source = 'retrying';
            updateMoonStatus(state);
            updateEarthshineViewButton(); // LOT 33: the note says the phase is not computed
            return;
        }
        if (!astronomyObserver) astronomyObserver = new Astronomy.Observer(0, 0, 0);
        const equatorial = Astronomy.Equator(Astronomy.Body.Moon, now, astronomyObserver, true, true);
        const sunEquatorial = Astronomy.Equator(Astronomy.Body.Sun, now, astronomyObserver, true, true);
        const siderealHours = Astronomy.SiderealTime(now);
        state.sublunarLon = normalizeLongitude((equatorial.ra - siderealHours) * 15);
        state.sublunarLat = equatorial.dec;
        state.distanceKm = Number(equatorial.dist) > 0
            ? equatorial.dist * AU_KM
            : MEAN_MOON_DISTANCE_KM;
        const moonDir = raDecToUnit(THREE, equatorial.ra, equatorial.dec);
        const sunDir = raDecToUnit(THREE, sunEquatorial.ra, sunEquatorial.dec);
        const elongationCos = THREE.MathUtils.clamp(moonDir.dot(sunDir), -1, 1);
        state.phaseFraction = (1 - elongationCos) * 0.5;
        // LOT 31: the Earth's phase angle seen from the Moon is this elongation (earthshine.js).
        const earthPhaseAngle = earthPhaseAngleFromElongationCos(elongationCos);
        const ratio = earthshineRatio({ earthPhaseAngle, distanceKm: state.distanceKm });
        state.earthshine = { ratio, stops: stopsBelowSun(ratio), earthPhaseAngleDeg: earthPhaseAngle * 180 / Math.PI, albedo: EARTH_GEOMETRIC_ALBEDO, distanceKm: state.distanceKm };
        // LOT 33: next Earthshine-view window from the displayed time, only while the view is unavailable.
        // A window found from `from` stays valid for any displayed time between `from` and its start.
        if (state.phaseFraction > EARTHSHINE_VIEW_MAX_LIT_FRACTION) {
            const t = now.getTime(); const cached = state.earthshineWindow;
            if (!cached || t < cached.from || !cached.start || t >= cached.start.getTime()) {
                const found = nextEarthshineWindow({ litFractionAt: (d) => moonLitFraction(Astronomy, d, astronomyObserver), from: now });
                state.earthshineWindow = { start: found?.start || null, end: found?.end || null, openNow: Boolean(found?.openNow), from: t };
            }
        }

        // Directia reala Soare, in ACELASI frame "world/scena" ca moon.position
        // (lonLatToVec3, ancorat la rotatia Pamantului via siderealHours) - NU
        // frame-ul inertial brut RA/Dec de mai sus (folosit corect doar pentru
        // unghiul de faza, unde frame-ul e irelevant). Necesara pentru zborul
        // camerei catre emisfera iluminata (vezi camera-motion.js startMoonTracking).
        const sunLon = normalizeLongitude((sunEquatorial.ra - siderealHours) * 15);
        const sunLat = sunEquatorial.dec;
        state.sunWorldDir.copy(lonLatToVec3(sunLon, sunLat, 1)).normalize();

        const distanceScale = THREE.MathUtils.clamp(MEAN_MOON_DISTANCE_KM / state.distanceKm, 0.92, 1.08);
        moon.position.copy(lonLatToVec3(state.sublunarLon, state.sublunarLat, MOON_SCENE_DISTANCE));
        moon.userData.distanceScale = distanceScale;
        moon.scale.setScalar(MOON_MIN_SIZE * distanceScale);

        // Orientarea reala a discului lunar: libration (Astronomy.Libration)
        // da unghiurile (elon, elat) ale punctului sub-Pamant real, deviate de
        // la pozitia "medie" (0,0 selenografic) din cauza "tidal locking"-ului
        // imperfect al Lunii. Rotim sfera astfel incat punctul selenografic
        // (elon, elat) - nu neaparat centrul texturii - sa priveasca spre
        // Pamant chiar acum. Fara asta, sfera nu are NICIO rotatie reala
        // (doar geometrie + lumina corecte, dar emisfera vizibila arbitrara).
        //
        // worldUpHint foloseste polul NORD REAL al Lunii (Astronomy.RotationAxis,
        // vector "north" deja in EQJ) - nu o aproximare fixa (0,1,0). Asta fixeaza
        // corect "roll"-ul discului (position angle), nu doar emisfera vizibila.
        try {
            const libration = Astronomy.Libration(now);
            state.librationElon = libration.elon;
            state.librationElat = libration.elat;
            const localForward = localDirForSelenographic(THREE, libration.elon, libration.elat);
            const worldForward = moon.position.clone().negate().normalize(); // spre Pamant (origine)
            const axis = Astronomy.RotationAxis(Astronomy.Body.Moon, now);
            const worldUpHint = raDecToUnit(THREE, axis.ra, axis.dec);
            const baseQuat = computeAlignedQuaternion(THREE, localForward, worldForward, worldUpHint);
            if (state.moonRollOffsetDeg) {
                const rollQuat = new THREE.Quaternion().setFromAxisAngle(worldForward, state.moonRollOffsetDeg * Math.PI / 180);
                baseQuat.premultiply(rollQuat);
            }
            moon.quaternion.copy(baseQuat);
            state.orientationSource = 'astronomy-engine (libration + real pole)';
        } catch (error) {
            console.warn('[Moon] Libration/RotationAxis calculation failed; orientation left unchanged.', error);
            state.orientationSource = 'unavailable';
        }

        moonHalo.position.copy(moon.position);
        moonHalo.scale.setScalar(MOON_MIN_SIZE * distanceScale * 1.12);
        moon.visible = true;
        moonHalo.visible = true;
        state.visible = true;
        state.source = 'astronomy-engine';
        enforceEarthshineViewThreshold(); // LOT 31 ETAPA 2b
        updateMoonStatus(state);
    }

    function update(camera) {
        if (!state.visible) return;
        moonHalo.position.copy(moon.position);
        if (!camera) return;

        const cameraToMoon = moon.position.clone().sub(camera.position);
        const moonDistance = cameraToMoon.length();
        const rayDir = cameraToMoon.clone().normalize();
        const closestPointOnRay = -camera.position.dot(rayDir);
        const closestDistanceToEarth = closestPointOnRay > 0 && closestPointOnRay < moonDistance
            ? camera.position.clone().add(rayDir.multiplyScalar(closestPointOnRay)).length()
            : Infinity;
        const isEarthOccluded = closestDistanceToEarth < EARTH_OCCLUSION_RADIUS;
        moon.visible = !isEarthOccluded;
        moonHalo.visible = !isEarthOccluded;
        if (isEarthOccluded) return;
        // moon e sfera reala - nu are nevoie de lookAt, arata identic din orice unghi.
        moonHalo.lookAt(camera.position);

        const distanceScale = moon.userData.distanceScale || 1;
        const apparentSize = THREE.MathUtils.clamp(
            moonDistance * MOON_APPARENT_SIZE * distanceScale,
            MOON_MIN_SIZE,
            MOON_MAX_SIZE
        );
        moon.scale.setScalar(apparentSize);
        moonHalo.scale.setScalar(apparentSize * 1.08);
    }

    function start() {
        updateMoonPosition();
        if (intervalId !== null) return;
        intervalId = setInterval(updateMoonPosition, refreshMs);
    }

    function stop() {
        stopped = true; // LOT 32: terminal for the warm-up and the pending texture loads
        prewarm?.cancel();
        noteFlash.dispose(); // LOT 33: no flash timer outlives the module
        if (intervalId === null) return;
        clearInterval(intervalId);
        intervalId = null;
    }

    return {
        moon,
        moonHalo,
        moonState: state,
        start,
        stop,
        update,
        updateMoonPosition,
        setMoonRollOffset,
        setMoonExposureEv,
        toggleEarthshineView,
        // LOT 32: diagnostics only (not shown in the Moon details)
        prewarmStatus: prewarm ? prewarm.status : { state: 'skipped', reason: prewarmDecision.reason }
    };
}
