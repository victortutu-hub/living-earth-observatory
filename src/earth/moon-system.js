const ASTRONOMY_ENGINE_URLS = [
    'https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/+esm',
    'https://esm.sh/astronomy-engine@2.1.19'
];
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
        ? `${Math.round(state.phaseFraction * 100)}% lit`
        : 'phase unknown';
    status.textContent = `Moon: ${phase} · ${formatMoonDistance(state.distanceKm)}`;
    status.title = `Moon position and phase from ${state.source}`;
}

const MOON_TEXTURE_URL = 'https://cdn.jsdelivr.net/gh/CoryG89/MoonDemo@master/img/maps/moon.jpg';
const MOON_NORMAL_URL = 'https://cdn.jsdelivr.net/gh/CoryG89/MoonDemo@master/img/maps/normal.jpg';
// Textura alternativa, oficiala NASA (domeniu public garantat) - LROC WAC
// Hapke Normalized Mosaic, varianta mica (1024x512), din CGI Moon Kit
// (https://svs.gsfc.nasa.gov/4720). CoryG89 (default) e derivata dintr-o
// harta mai veche (Steve Albers/Jens Meyer) descrisa explicit ca "free for
// personal non-commercial use" - nu domeniu public. Daca statutul proiectului
// cere licenta 100% clara, comuta pe aceasta varianta din UI (buton "Moon texture").
// La fel ca la elevatie, CORS-ul NASA blocheaza fetch direct - necesita asset local.
const MOON_TEXTURE_NASA_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg';
const MOON_TEXTURE_NASA_LOCAL_PATH = 'assets/moon-lroc-color-1k-1024x512.jpg';
// Elevatie reala LOLA - NASA SVS CGI Moon Kit (https://svs.gsfc.nasa.gov/4720).
// PROBLEMA CONFIRMATA: serverul NASA trimite Access-Control-Allow-Origin cu
// o valoare fixa ('https://tempo.multiverse.music'), nu wildcard - fetch-ul
// din orice alt origine (inclusiv localhost) e blocat de CORS in browser.
// Displacement/bump dezactivate din acest motiv - vezi mai jos.
// Solutie corecta pe termen lung: descarca manual acest fisier (navigare
// directa in browser, nu fetch JS - CORS nu blocheaza asta) si salveaza-l
// local in assets/, exact ca la relieful Pamantului (earth-textures.js).
// Apoi seteaza MOON_DISPLACEMENT_LOCAL_PATH mai jos catre acel fisier.
const MOON_DISPLACEMENT_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_3_8bit.jpg';
const MOON_DISPLACEMENT_LOCAL_PATH = 'assets/moon-ldem-elevation-1024x512.jpg';

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
// "centered on 0 deg longitude" folosita si de NASA si de harta CoryG89).
// NOTA: semnul longitudinii (est/vest) pentru harta CoryG89 (mai veche, ~2013,
// posibil conventie pre-IAU2000) nu e 100% confirmat - MOON_LONGITUDE_SIGN e
// izolat aici exact pentru a putea fi inversat cu o singura schimbare daca la
// verificare vizuala (comparat cu o fotografie reala a Lunii) wobble-ul de
// libration se misca in directia gresita.
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

// Textura reala a Lunii (mozaic fotografic 4096x2048 derivat din date satelit
// Clementine/LRO, procesat de Steve Albers/Jens Meyer, gazduit pe GitHub,
// servit cu CORS via jsDelivr). Craterele si mariile sunt geografia lunara
// reala, nu o aproximare artistica.
function createMoonTexture(THREE) {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(MOON_TEXTURE_URL);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

// Varianta NASA (domeniu public), incarcata doar din assetul local (vezi
// comentariul de la MOON_TEXTURE_NASA_LOCAL_PATH). Returneaza null daca
// fisierul local nu exista inca - butonul de toggle din UI va afisa eroarea
// clar in consola, fara sa stripeze textura curenta (CoryG89 ramane activa).
function createMoonTextureNasa(THREE) {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(
        MOON_TEXTURE_NASA_LOCAL_PATH,
        undefined, undefined,
        handleTextureLoadError('NASA texture', MOON_TEXTURE_NASA_LOCAL_PATH)
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

// Normal map generat din acelasi releif real (aceeasi sursa ca textura de
// culoare) - adauga detaliu fin de iluminare pe cratere fara sa modifice geometria.
function createMoonNormalTexture(THREE) {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(MOON_NORMAL_URL, undefined, undefined, handleTextureLoadError('Normal map', MOON_NORMAL_URL));
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
}

// Harta de elevatie reala LOLA - folosita atat pentru displacement (deformare
// geometrica reala a sferei) cat si ca bump fin suplimentar, exact ca la
// Pamant. Returneaza null daca nu exista sursa locala configurata (CDN-ul
// NASA are CORS blocat pentru origini externe - vezi comentariul de mai sus).
function createMoonDisplacementTexture(THREE) {
    if (!MOON_DISPLACEMENT_LOCAL_PATH) return null;
    const loader = new THREE.TextureLoader();
    const texture = loader.load(
        MOON_DISPLACEMENT_LOCAL_PATH,
        undefined, undefined,
        handleTextureLoadError('Displacement map', MOON_DISPLACEMENT_LOCAL_PATH)
    );
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
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

// Earthshine: lumina reflectata de Pamant pe fata intunecata a Lunii.
// Aproximare poetica/fizica: glow albastru-cenusiu in jurul discului,
// intensitate legata de (1 - phaseFraction) - maxima la Luna noua,
// zero la Luna plina. Strat aditiv separat, nu atinge textura principala.
function createEarthshineTexture(THREE) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const center = canvas.width / 2;
    const glow = ctx.createRadialGradient(center, center, 10, center, center, 122);
    glow.addColorStop(0, 'rgba(150,175,205,0.55)');
    glow.addColorStop(0.32, 'rgba(120,150,190,0.30)');
    glow.addColorStop(0.68, 'rgba(90,120,165,0.10)');
    glow.addColorStop(1, 'rgba(90,120,165,0)');
    ctx.fillStyle = glow;
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
    refreshMs = 60000
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
        textureSource: 'coryg89',
        librationElon: 0,
        librationElat: 0,
        orientationSource: 'pending',
        moonRollOffsetDeg: 0,
        sunWorldDir: new THREE.Vector3(1, 0, 0)
    };
    const moonTextureCoryG89 = createMoonTexture(THREE);
    const moonTextureNasa = createMoonTextureNasa(THREE);
    const moonNormalTexture = createMoonNormalTexture(THREE);
    const moonDisplacementTexture = createMoonDisplacementTexture(THREE); // null pana adaugi assetul local
    // Sfera reala (nu billboard plat) - textura echirectangulara se infasoara
    // corect doar pe o sfera. Raza 0.5 => diametru 1, ca sa pastram identic
    // conventia veche de scalare (scale.setScalar(x) = diametrul aparent).
    // Segmente marite (256x192, fata de 64x48) pentru ca displacement-ul real
    // sa aiba suficiente vertecsi ca sa arate neted la zoom apropiat, exact
    // ca la relieful Pamantului.
    const moonSphereGeometry = new THREE.SphereGeometry(0.5, 256, 192);
    // Geometrie plata separata, doar pentru halo si earthshine (billboard-uri
    // aditive care inca trebuie sa priveasca mereu camera).
    const moonBillboardGeometry = new THREE.PlaneGeometry(1, 1, 2, 2);
    // MeshLambertMaterial (difuz, fara specular) - Luna nu are atmosfera care
    // sa produca luciu; se lumineaza automat, fizic corect, din sunLight-ul
    // real deja folosit pentru Pamant (aceeasi directie solara, faza corecta
    // reiese direct din geometrie, nu mai e nevoie de shader custom).
    // displacementMap/bumpMap adaugate DOAR daca exista un asset local valid
    // (moonDisplacementTexture non-null) - CORS-ul NASA blocheaza incarcarea
    // directa, deci pana la adaugarea assetului local, Luna ramane cu
    // culoare + normal map, fara deformare geometrica reala.
    const moonMatParams = {
        map: moonTextureCoryG89,
        color: 0xffffff,
        emissive: 0x10263a,
        emissiveIntensity: 0.18,
        normalMap: moonNormalTexture,
        normalScale: new THREE.Vector2(0.6, 0.6)
    };
    if (moonDisplacementTexture) {
        moonMatParams.bumpMap = moonDisplacementTexture;
        moonMatParams.bumpScale = 0.015;
        moonMatParams.displacementMap = moonDisplacementTexture;
        moonMatParams.displacementScale = 0.035;
        moonMatParams.displacementBias = -0.017;
    }
    const moonMat = new THREE.MeshLambertMaterial(moonMatParams);
    moonMat.userData.textureSource = MOON_TEXTURE_URL;
    moonMat.userData.displacementSource = moonDisplacementTexture ? MOON_DISPLACEMENT_LOCAL_PATH : 'unavailable (NASA CORS blocked, no local asset yet)';
    const moon = new THREE.Mesh(moonSphereGeometry, moonMat);
    moon.name = 'astronomical-moon';
    moon.visible = false;
    moon.renderOrder = 6;
    moon.userData.specialId = 'moon';
    scene.add(moon);

    // Toggle textura culoare: CoryG89 (default, 4096x2048, real dar licenta
    // sursei originale ambigua - "personal non-commercial use") <-> NASA
    // (1024x512, domeniu public garantat, doar daca assetul local exista).
    function setTextureSource(source) {
        if (source === 'nasa') {
            moonMat.map = moonTextureNasa;
            moonMat.userData.textureSource = MOON_TEXTURE_NASA_LOCAL_PATH;
            state.textureSource = 'nasa';
        } else {
            moonMat.map = moonTextureCoryG89;
            moonMat.userData.textureSource = MOON_TEXTURE_URL;
            state.textureSource = 'coryg89';
        }
        moonMat.needsUpdate = true;
    }

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

    const moonEarthshine = new THREE.Mesh(moonBillboardGeometry.clone(), new THREE.MeshBasicMaterial({
        map: createEarthshineTexture(THREE),
        color: 0xaac0e0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
    }));
    moonEarthshine.name = 'astronomical-moon-earthshine';
    moonEarthshine.visible = false;
    moonEarthshine.renderOrder = 4;
    scene.add(moonEarthshine);

    let astronomyEngine = null;
    let astronomyLoadPromise = null;
    let astronomyObserver = null;
    let intervalId = null;
    let astronomyRetryAt = 0;
    let earthshineBoost = 1;

    function currentEarthshineOpacity() {
        const baseOpacity = THREE.MathUtils.clamp((1 - state.phaseFraction) * 0.16, 0, 0.16);
        return THREE.MathUtils.clamp(baseOpacity * earthshineBoost, 0, 0.07);
    }

    function applyEarthshineOpacity() {
        const opacity = currentEarthshineOpacity();
        moonEarthshine.material.opacity = opacity;
        moonEarthshine.userData.visibleByPhase = opacity > 0.01;
        moonEarthshine.visible = state.visible && moonEarthshine.userData.visibleByPhase;
    }

    function setEarthshineBoost(boost = 1) {
        earthshineBoost = THREE.MathUtils.clamp(Number(boost) || 1, 1, 3.2);
        applyEarthshineOpacity();
    }

    async function loadAstronomyEngine() {
        if (astronomyEngine) return astronomyEngine;
        if (Date.now() < astronomyRetryAt) return null;
        if (!astronomyLoadPromise) {
            astronomyLoadPromise = (async () => {
                for (const url of ASTRONOMY_ENGINE_URLS) {
                    try {
                        const module = await import(url);
                        astronomyEngine = module.default || module;
                        astronomyObserver = new astronomyEngine.Observer(0, 0, 0);
                        return astronomyEngine;
                    } catch (error) {
                        console.warn(`[Moon] Astronomy Engine import failed from ${url}.`, error);
                    }
                }
                astronomyRetryAt = Date.now() + 30000;
                state.source = 'retrying';
                updateMoonStatus(state);
                return null;
            })().finally(() => {
                astronomyLoadPromise = null;
            });
        }
        return astronomyLoadPromise;
    }

    async function updateMoonPosition(now = new Date()) {
        const Astronomy = await loadAstronomyEngine();
        if (!Astronomy) {
            moon.visible = false;
            moonHalo.visible = false;
            moonEarthshine.visible = false;
            state.visible = false;
            updateMoonStatus(state);
            return;
        }
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
        moonEarthshine.position.copy(moon.position);
        moonEarthshine.scale.setScalar(MOON_MIN_SIZE * distanceScale * 1.24);
        moon.visible = true;
        moonHalo.visible = true;
        state.visible = true;
        state.source = 'astronomy-engine';
        applyEarthshineOpacity();
        updateMoonStatus(state);
    }

    function update(camera) {
        if (!state.visible) return;
        moonHalo.position.copy(moon.position);
        moonEarthshine.position.copy(moon.position);
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
        moonEarthshine.visible = !isEarthOccluded && moonEarthshine.userData.visibleByPhase;
        if (isEarthOccluded) return;
        // moon e sfera reala - nu are nevoie de lookAt, arata identic din orice unghi.
        moonHalo.lookAt(camera.position);
        moonEarthshine.lookAt(camera.position);

        const distanceScale = moon.userData.distanceScale || 1;
        const apparentSize = THREE.MathUtils.clamp(
            moonDistance * MOON_APPARENT_SIZE * distanceScale,
            MOON_MIN_SIZE,
            MOON_MAX_SIZE
        );
        moon.scale.setScalar(apparentSize);
        moonHalo.scale.setScalar(apparentSize * 1.08);
        moonEarthshine.scale.setScalar(apparentSize * 1.2);
    }

    function start() {
        updateMoonPosition();
        if (intervalId !== null) return;
        intervalId = setInterval(updateMoonPosition, refreshMs);
    }

    function stop() {
        if (intervalId === null) return;
        clearInterval(intervalId);
        intervalId = null;
    }

    return {
        moon,
        moonHalo,
        moonEarthshine,
        moonState: state,
        start,
        stop,
        update,
        updateMoonPosition,
        setTextureSource,
        setMoonRollOffset,
        setEarthshineBoost
    };
}
