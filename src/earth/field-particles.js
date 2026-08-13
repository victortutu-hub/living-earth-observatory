// Motor generic de particule advectate pe un camp vectorial global (vant sau
// curenti oceanici). Extras din Sprint 2.2 (vant) ca sa fie refolosit de
// Sprint 2.3 (curenti) - aceeasi tehnica: pozitiile traiesc intr-o textura,
// integrate pe GPU printr-un ping-pong de FBO (GPUComputationRenderer, WebGL2).
//
// STREAMLINES: trail-urile se acumuleaza intr-o textura ECHIRECTANGULARA
// (lon/lat) mapata pe sfera - pe un glob rotativ un buffer spatiu-ecran ar
// lasa smear la rotatie; cel echirectangular se lipeste de geografie. Fiecare
// cadru: fade(bufferul precedent) + capetele proaspete, apoi ping-pong.
//
// Camp: R = u, G = v (normalizate pe uMaxSpeed), B = masca (1 = valid, 0 =
// uscat) folosita doar cand landAware (curentii nu trec peste continente).
//
// Provenance: campul e 'observed' (model real), reprezentarea ca streamlines e
// o conventie de vizualizare - 'interpretive' pentru miscare, 'observed' pentru
// campul subiacent.
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

const TRAIL_WIDTH = 2048;
const TRAIL_HEIGHT = 1024;

function buildComputeShader(landAware) {
    return `
    uniform sampler2D uFieldMap;
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

        vec2 fieldUv = vec2((lon + 180.0) / 360.0, clamp((lat + 80.0) / 160.0, 0.0, 1.0));
        vec4 fieldSample = texture2D(uFieldMap, fieldUv);
        vec2 fieldMs = (fieldSample.rg * 2.0 - 1.0) * uMaxSpeed;

        ${landAware ? `
        // Masca de uscat: peste continente campul nu are date (B < 0.5).
        // Fortam respawn ca sa nu se acumuleze particule statice pe uscat.
        if (fieldSample.b < 0.5) age = 2.0;
        ` : ''}

        // Integrare in grade: metri/s -> grade/pas, cu corectia de convergenta
        // a meridianelor (Atentie la poli: clamp explicit al divizorului).
        float latRad = radians(lat);
        float metersPerDegLat = 111320.0;
        float metersPerDegLon = max(111320.0 * cos(latRad), 4000.0);

        lon += (fieldMs.x * uDeltaTime / metersPerDegLon) * uSpeedScale;
        lat += (fieldMs.y * uDeltaTime / metersPerDegLat) * uSpeedScale;

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
            // Distributie uniforma PE SFERA (asin), nu uniforma in latitudine
            // (care ar aglomera respawn-urile la poli).
            lat = degrees(asin(rnd.y * 2.0 - 1.0));
            age = fract(rnd.x * 1.7);
        }

        gl_FragColor = vec4((lon + 180.0) / 360.0, (lat + 90.0) / 180.0, age, 1.0);
    }
    `;
}

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
    uniform vec3 uHeadColor;
    uniform float uHeadAlpha;
    varying float vAge;
    void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p) * 2.0;
        float core = smoothstep(1.0, 0.0, d);
        float lifeFade = smoothstep(0.0, 0.06, vAge) * smoothstep(1.0, 0.8, vAge);
        float a = core * lifeFade * uHeadAlpha;
        if (a < 0.02) discard;
        gl_FragColor = vec4(uHeadColor, a);
    }
`;

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

export function createFieldParticles({
    THREE,
    renderer,
    earthGroup,
    fetchField,
    label = 'Field',
    sourceLabel = 'field',
    gridSize = 128,
    landAware = false,
    speedScale = 50000,
    trailFade = 0.985,
    displayRadius = 2.05,
    headColor = [0.62, 0.80, 1.0],
    headAlpha = 0.6,
    pointSize = 2.0,
    displayOpacity = 0.85,
}) {
    let disposed = false;
    let enabled = false;
    let loading = false;
    let lastError = null;
    let ready = false;
    let fieldMeta = null;

    let gpuCompute = null;
    let positionVariable = null;
    let lastT = null;

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
    group.name = `field-particles-${label.toLowerCase()}`;
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
                uPointSize: { value: pointSize },
                uHeadColor: { value: new THREE.Color(headColor[0], headColor[1], headColor[2]) },
                uHeadAlpha: { value: headAlpha },
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
                uFade: { value: trailFade },
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

        displayMaterial = new THREE.MeshBasicMaterial({
            map: trailRead.texture,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false,
            depthTest: true,
            side: THREE.FrontSide,
            opacity: displayOpacity,
        });
        displayMesh = new THREE.Mesh(new THREE.SphereGeometry(displayRadius, 64, 48), displayMaterial);
        displayMesh.renderOrder = 5;
        group.add(displayMesh);
    }

    function setupCompute(fieldTexture) {
        gpuCompute = new GPUComputationRenderer(gridSize, gridSize, renderer);
        const positionTexture = gpuCompute.createTexture();
        const data = positionTexture.image.data;
        for (let i = 0; i < gridSize * gridSize; i++) {
            const rndLon = Math.random();
            const rndLat = Math.random();
            data[i * 4] = rndLon;
            data[i * 4 + 1] = (Math.asin(rndLat * 2 - 1) / Math.PI + 0.5);
            data[i * 4 + 2] = Math.random();
            data[i * 4 + 3] = 1;
        }

        positionVariable = gpuCompute.addVariable('texturePosition', buildComputeShader(landAware), positionTexture);
        gpuCompute.setVariableDependencies(positionVariable, [positionVariable]);
        positionVariable.material.uniforms.uFieldMap = { value: fieldTexture };
        positionVariable.material.uniforms.uMaxSpeed = { value: fieldTexture.userData.maxSpeedMs };
        positionVariable.material.uniforms.uDeltaTime = { value: 0 };
        positionVariable.material.uniforms.uSpeedScale = { value: speedScale };
        positionVariable.material.uniforms.uTime = { value: 0 };

        const error = gpuCompute.init();
        if (error !== null) throw new Error(error);
    }

    async function load() {
        if (disposed) return;
        loading = true;
        lastError = null;
        try {
            const fieldTexture = await fetchField({ THREE });
            if (disposed) return;
            fieldMeta = fieldTexture.userData;
            setupCompute(fieldTexture);
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

    function update(t) {
        if (!ready || !enabled || disposed) return;
        if (lastT === null) lastT = t;
        const dt = Math.min(0.25, Math.max(0, t - lastT));
        lastT = t;

        positionVariable.material.uniforms.uDeltaTime.value = dt;
        positionVariable.material.uniforms.uTime.value = t;
        gpuCompute.compute();

        const prevTarget = renderer.getRenderTarget();
        const prevAutoClear = renderer.autoClear;
        renderer.autoClear = false;

        fadeMaterial.uniforms.uPrev.value = trailRead.texture;
        pointMaterial.uniforms.uPositionTexture.value =
            gpuCompute.getCurrentRenderTarget(positionVariable).texture;

        renderer.setRenderTarget(trailWrite);
        renderer.render(fadeScene, trailCamera);
        renderer.render(pointScene, trailCamera);

        renderer.setRenderTarget(prevTarget);
        renderer.autoClear = prevAutoClear;

        const swap = trailRead;
        trailRead = trailWrite;
        trailWrite = swap;
        displayMaterial.map = trailRead.texture;
    }

    function getStatus() {
        if (loading) return { enabled, loading, state: 'refreshing', message: `${label}: loading...` };
        if (lastError) return { enabled, loading, state: 'error', message: `${label}: ${lastError.message || 'network error'}` };
        if (!enabled) return { enabled, loading, state: 'off', message: `${label}: off` };
        if (!ready) return { enabled, loading, state: 'refreshing', message: `${label}: preparing simulation...` };
        return {
            enabled,
            loading,
            state: 'on',
            message: `${label}: ${sourceLabel} (${fieldMeta.gridPoints} grid points)${fieldMeta.cached ? ' — cached' : ''}, ${gridSize * gridSize} particles`,
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
