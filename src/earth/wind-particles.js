// Sprint 2.2 - particule de vant, tehnica canonica (earth.nullschool.net /
// Windy / Wind-JS): pozitiile particulelor traiesc intr-o textura, integrate
// pe GPU printr-un ping-pong de FBO (GPUComputationRenderer, WebGL2 - Sprint
// 2.1 a taiat migrarea completa la WebGPURenderer, deci ramanem pe calea
// clasica FBO in loc de compute shader WGSL).
//
// STREAMLINES (trail): particulele individuale, ca puncte, arata doar ca niste
// punctulete fara sens - nu comunica directia/curgerea. Solutia canonica e o
// dara care se estompeaza in urma fiecarei particule. Pe un GLOB CARE SE
// ROTESTE, un buffer de trail in spatiu-ecran ar lasa smear la rotatie. De
// aceea acumulam trail-urile intr-o textura ECHIRECTANGULARA (lon/lat) pe care
// o mapam pe sfera: dara se "lipeste" de geografie si se roteste corect cu
// globul. Fiecare cadru: fade(bufferul precedent) + capetele proaspete ale
// particulelor, apoi ping-pong.
//
// Provenance: campul de vant e 'observed' (Open-Meteo, model meteorologic
// real), dar reprezentarea ca streamlines e o conventie de vizualizare
// consacrata (nullschool etc.), nu o masuratoare directa - 'interpretive'
// pentru miscarea vizuala, 'observed' pentru campul vectorial subiacent.
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { fetchWindFieldTexture } from './wind-field-provider.js?v=windCache1';

const TRAIL_WIDTH = 2048;
const TRAIL_HEIGHT = 1024;
// Cat de repede se estompeaza dara. 1/(1-FADE) ~ lungimea in cadre: 0.985 ~ 66
// cadre (~1.1s la 60fps). Mai mare = dare mai lungi, dar mai aglomerat.
const TRAIL_FADE = 0.985;

const POSITION_COMPUTE_SHADER = `
    uniform sampler2D uWindMap;
    uniform float uMaxSpeed;
    uniform float uDeltaTime;
    uniform float uSpeedScale;
    uniform float uTime;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 posData = texture2D(texturePosition, uv);
        float lon = posData.x * 360.0 - 180.0;
        float lat = posData.y * 180.0 - 90.0;
        float age = posData.z;

        vec2 windUv = vec2((lon + 180.0) / 360.0, clamp((lat + 80.0) / 160.0, 0.0, 1.0));
        vec4 windSample = texture2D(uWindMap, windUv);
        vec2 windMs = (windSample.rg * 2.0 - 1.0) * uMaxSpeed;

        // Integrare in grade: metri/s -> grade/pas, cu corectia de convergenta
        // a meridianelor la latitudine (Atentie la poli: clamp explicit ca sa
        // nu explodeze derivata longitudinii aproape de +-90).
        float latRad = radians(lat);
        float metersPerDegLat = 111320.0;
        float metersPerDegLon = max(111320.0 * cos(latRad), 4000.0);

        lon += (windMs.x * uDeltaTime / metersPerDegLon) * uSpeedScale;
        lat += (windMs.y * uDeltaTime / metersPerDegLat) * uSpeedScale;

        lon = mod(lon + 180.0, 360.0) - 180.0;
        lat = clamp(lat, -89.0, 89.0);

        age += uDeltaTime * 0.05;

        float seed = hash(uv + vec2(uTime * 0.017, uTime * 0.011));
        bool respawn = age > 1.0 || seed < 0.0006;
        if (respawn) {
            vec2 rnd = vec2(
                hash(uv + vec2(uTime * 1.31, 7.0)),
                hash(uv.yx + vec2(uTime * 0.71, 3.0))
            );
            lon = rnd.x * 360.0 - 180.0;
            // Distributie uniforma PE SFERA (nu uniforma in latitudine) - o
            // distributie naiva uniforma in lat ar aglomera respawn-urile la
            // poli, unde cercurile de latitudine sunt mici.
            lat = degrees(asin(rnd.y * 2.0 - 1.0));
            age = fract(rnd.x * 1.7);
        }

        gl_FragColor = vec4((lon + 180.0) / 360.0, (lat + 90.0) / 180.0, age, 1.0);
    }
`;

// Particulele desenate in spatiul ECHIRECTANGULAR (nu pe sfera): gl_Position
// direct din lon/lat -> NDC, deci camera e irelevanta. Capetele se acumuleaza
// aditiv in bufferul de trail.
const TRAIL_POINT_VERTEX = `
    attribute vec2 aUv;
    uniform sampler2D uPositionTexture;
    uniform float uPointSize;
    varying float vAge;
    void main() {
        vec4 posData = texture2D(uPositionTexture, aUv);
        float lon = posData.x * 360.0 - 180.0;
        float lat = posData.y * 180.0 - 90.0;
        vAge = posData.z;
        gl_Position = vec4(lon / 180.0, lat / 90.0, 0.0, 1.0);
        gl_PointSize = uPointSize;
    }
`;

const TRAIL_POINT_FRAGMENT = `
    varying float vAge;
    void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p) * 2.0;
        float core = smoothstep(1.0, 0.0, d);
        // fade in la nastere, fade out inainte de respawn - evita "pop"-ul.
        float lifeFade = smoothstep(0.0, 0.06, vAge) * smoothstep(1.0, 0.8, vAge);
        float a = core * lifeFade * 0.6;
        if (a < 0.02) discard;
        // Additive in buffer: contributia e color*a. Culoare rece de vant.
        gl_FragColor = vec4(vec3(0.62, 0.80, 1.0), a);
    }
`;

// Quad fullscreen care copiaza bufferul precedent estompat (NoBlending -> il
// suprascrie), baza peste care se adauga capetele proaspete.
const TRAIL_FADE_VERTEX = `
    varying vec2 vUv;
    void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const TRAIL_FADE_FRAGMENT = `
    uniform sampler2D uPrev;
    uniform float uFade;
    varying vec2 vUv;
    void main() {
        gl_FragColor = texture2D(uPrev, vUv) * uFade;
    }
`;

export function createWindParticles({ THREE, renderer, earthGroup, gridSize = 128 }) {
    let disposed = false;
    let enabled = false;
    let loading = false;
    let lastError = null;
    let ready = false;
    let windMeta = null;

    let gpuCompute = null;
    let positionVariable = null;
    let lastT = null;

    // Trail: ping-pong de render targets echirectangulare.
    let trailRead = null;
    let trailWrite = null;
    let fadeScene = null;
    let pointScene = null;
    let trailCamera = null;
    let fadeMaterial = null;
    let pointMaterial = null;
    let displayMaterial = null;
    let displayMesh = null;

    const group = new THREE.Group();
    group.name = 'wind-particles';
    group.visible = false;
    earthGroup.add(group);

    function makeTrailTarget() {
        return new THREE.WebGLRenderTarget(TRAIL_WIDTH, TRAIL_HEIGHT, {
            depthBuffer: false,
            stencilBuffer: false,
            type: THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.RepeatWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
        });
    }

    function buildTrailPipeline() {
        trailRead = makeTrailTarget();
        trailWrite = makeTrailTarget();
        trailCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // Grid UV pentru citirea texturii de pozitii (o intrare per particula).
        const count = gridSize * gridSize;
        const positions = new Float32Array(count * 3);
        const uvs = new Float32Array(count * 2);
        let i = 0;
        for (let row = 0; row < gridSize; row++) {
            for (let col = 0; col < gridSize; col++) {
                uvs[i * 2] = (col + 0.5) / gridSize;
                uvs[i * 2 + 1] = (row + 0.5) / gridSize;
                i++;
            }
        }
        const pointGeometry = new THREE.BufferGeometry();
        pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        pointGeometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));

        pointMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uPositionTexture: { value: null },
                uPointSize: { value: 2.0 },
            },
            vertexShader: TRAIL_POINT_VERTEX,
            fragmentShader: TRAIL_POINT_FRAGMENT,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const pointCloud = new THREE.Points(pointGeometry, pointMaterial);
        pointCloud.frustumCulled = false;
        pointScene = new THREE.Scene();
        pointScene.add(pointCloud);

        fadeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uPrev: { value: null },
                uFade: { value: TRAIL_FADE },
            },
            vertexShader: TRAIL_FADE_VERTEX,
            fragmentShader: TRAIL_FADE_FRAGMENT,
            depthTest: false,
            depthWrite: false,
            blending: THREE.NoBlending,
        });
        const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMaterial);
        fadeQuad.frustumCulled = false;
        fadeScene = new THREE.Scene();
        fadeScene.add(fadeQuad);

        // Sfera de afisare: bufferul echirectangular mapat pe glob. La radius
        // 2.05 (peste suprafata 2.0 si night lights 2.025). NormalBlending (nu
        // Additive): aditiv peste ziua luminoasa a Pamantului + bloom spala
        // dârele spre alb. Doar fata din fata (FrontSide + depthTest) - fata
        // din spate e ocluzata de glob.
        displayMaterial = new THREE.MeshBasicMaterial({
            map: trailRead.texture,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false,
            depthTest: true,
            side: THREE.FrontSide,
            opacity: 0.85,
        });
        displayMesh = new THREE.Mesh(new THREE.SphereGeometry(2.05, 64, 48), displayMaterial);
        displayMesh.renderOrder = 5;
        group.add(displayMesh);
    }

    function setupCompute(windTexture) {
        gpuCompute = new GPUComputationRenderer(gridSize, gridSize, renderer);
        const positionTexture = gpuCompute.createTexture();
        const data = positionTexture.image.data;
        for (let i = 0; i < gridSize * gridSize; i++) {
            const rndLon = Math.random();
            const rndLat = Math.random();
            data[i * 4] = rndLon;
            data[i * 4 + 1] = (Math.asin(rndLat * 2 - 1) / Math.PI + 0.5);
            data[i * 4 + 2] = Math.random(); // age initial, esalonat
            data[i * 4 + 3] = 1;
        }

        positionVariable = gpuCompute.addVariable('texturePosition', POSITION_COMPUTE_SHADER, positionTexture);
        gpuCompute.setVariableDependencies(positionVariable, [positionVariable]);
        positionVariable.material.uniforms.uWindMap = { value: windTexture };
        positionVariable.material.uniforms.uMaxSpeed = { value: windTexture.userData.maxSpeedMs };
        positionVariable.material.uniforms.uDeltaTime = { value: 0 };
        // Factor de accelerare a timpului pentru vizualizare. Advectia reala pe
        // glob e prea lenta ca s-o vezi (10 m/s ~ 0.0001 grade/s). La 8000
        // particula se misca ~0.065 px/cadru in bufferul de trail - depune pe
        // acelasi pixel = punct static, nu dâra. ~50000 o face sa avanseze
        // ~0.4 px/cadru => dâra continua vizibila.
        positionVariable.material.uniforms.uSpeedScale = { value: 50000 };
        positionVariable.material.uniforms.uTime = { value: 0 };

        const error = gpuCompute.init();
        if (error !== null) throw new Error(error);
    }

    async function load() {
        if (disposed) return;
        loading = true;
        lastError = null;
        try {
            const windTexture = await fetchWindFieldTexture({ THREE });
            if (disposed) return;
            windMeta = windTexture.userData;
            setupCompute(windTexture);
            buildTrailPipeline();
            ready = true;
            group.visible = enabled;
        } catch (error) {
            lastError = error;
        } finally {
            loading = false;
        }
    }

    async function setEnabled(value) {
        if (disposed) return;
        enabled = Boolean(value);
        if (ready) group.visible = enabled;
        if (enabled && !ready && !loading) await load();
    }

    // t: secunde de la start-ul scenei (acelasi ceas absolut ca restul buclei;
    // app-runtime.js paseaza clock.getElapsedTime()), delta calculat aici.
    function update(t) {
        if (!ready || !enabled || disposed) return;
        if (lastT === null) lastT = t;
        const dt = Math.min(0.25, Math.max(0, t - lastT));
        lastT = t;

        positionVariable.material.uniforms.uDeltaTime.value = dt;
        positionVariable.material.uniforms.uTime.value = t;
        gpuCompute.compute();

        // Trail: write = fade(read) + capete particule. Salvam/refacem starea
        // renderer-ului ca sa nu stricam randarea principala (composer).
        const prevTarget = renderer.getRenderTarget();
        const prevAutoClear = renderer.autoClear;
        renderer.autoClear = false;

        fadeMaterial.uniforms.uPrev.value = trailRead.texture;
        pointMaterial.uniforms.uPositionTexture.value =
            gpuCompute.getCurrentRenderTarget(positionVariable).texture;

        renderer.setRenderTarget(trailWrite);
        renderer.render(fadeScene, trailCamera);   // suprascrie cu precedentul estompat
        renderer.render(pointScene, trailCamera);  // adauga capetele proaspete (additive)

        renderer.setRenderTarget(prevTarget);
        renderer.autoClear = prevAutoClear;

        const swap = trailRead;
        trailRead = trailWrite;
        trailWrite = swap;
        displayMaterial.map = trailRead.texture;
    }

    function getStatus() {
        if (loading) return { enabled, loading, state: 'refreshing', message: 'Wind: loading Open-Meteo global grid...' };
        if (lastError) return { enabled, loading, state: 'error', message: `Wind: ${lastError.message || 'network error'}` };
        if (!enabled) return { enabled, loading, state: 'off', message: 'Wind: off' };
        if (!ready) return { enabled, loading, state: 'refreshing', message: 'Wind: preparing simulation...' };
        return {
            enabled,
            loading,
            state: 'on',
            message: `Wind: Open-Meteo current field (${windMeta.gridPoints} grid points), ${gridSize * gridSize} particles`,
        };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        gpuCompute?.dispose?.();
        trailRead?.dispose?.();
        trailWrite?.dispose?.();
        fadeScene?.traverse(node => { node.geometry?.dispose?.(); });
        pointScene?.traverse(node => { node.geometry?.dispose?.(); });
        fadeMaterial?.dispose?.();
        pointMaterial?.dispose?.();
        displayMesh?.geometry?.dispose?.();
        displayMaterial?.dispose?.();
        earthGroup.remove(group);
    }

    return { setEnabled, update, getStatus, dispose };
}
