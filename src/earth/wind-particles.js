// Sprint 2.2 - particule de vant, tehnica canonica (earth.nullschool.net /
// Windy / Wind-JS): pozitiile particulelor traiesc intr-o textura, integrate
// pe GPU printr-un ping-pong de FBO (GPUComputationRenderer, WebGL2 - Sprint
// 2.1 a taiat migrarea completa la WebGPURenderer, deci ramanem pe calea
// clasica FBO in loc de compute shader WGSL). Randate ca puncte care isi
// citesc pozitia din textura de calcul in vertex shader.
//
// Provenance: campul de vant e 'observed' (Open-Meteo, model meteorologic
// real), dar reprezentarea ca particule/streamlines e o conventie de
// vizualizare consacrata (nullschool etc.), nu o masuratoare directa a
// particulelor individuale - etichetat 'interpretive' pentru miscarea vizuala
// in sine, pastrand 'observed' pentru campul vectorial subiacent.
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { fetchWindFieldTexture } from './wind-field-provider.js?v=windParticles1';

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

const POINTS_VERTEX_SHADER = `
    attribute vec2 aUv;
    uniform sampler2D uPositionTexture;
    uniform float uRadius;
    uniform float uPixelRatio;
    varying float vAge;
    varying float vFacing;

    void main() {
        vec4 posData = texture2D(uPositionTexture, aUv);
        float lon = posData.x * 360.0 - 180.0;
        float lat = posData.y * 180.0 - 90.0;
        vAge = posData.z;

        // Trebuie sa ramana identic cu lonLatToVec3 din geo.js.
        float phi = radians(90.0 - lat);
        float theta = radians(lon + 180.0);
        vec3 pos = vec3(
            -uRadius * sin(phi) * cos(theta),
             uRadius * cos(phi),
             uRadius * sin(phi) * sin(theta)
        );

        vec3 worldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
        vec3 worldNormal = normalize(worldPos);
        vec3 viewDir = normalize(cameraPosition - worldPos);
        vFacing = smoothstep(-0.05, 0.30, dot(worldNormal, viewDir));

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        // Puncte MICI, dimensiune ~fixa (nu 300/z, care dadea ~18px). Cu 16k+
        // particule, puncte mari + blending aditiv saturau tot ecranul la alb.
        gl_PointSize = uPixelRatio * 1.6;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const POINTS_FRAGMENT_SHADER = `
    uniform float uOpacity;
    varying float vAge;
    varying float vFacing;

    void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p) * 2.0;
        float core = smoothstep(1.0, 0.0, d);
        // fade in la nastere, fade out inainte de respawn - evita "pop"-ul.
        float lifeFade = smoothstep(0.0, 0.08, vAge) * smoothstep(1.0, 0.85, vAge);
        float alpha = core * lifeFade * vFacing * uOpacity;
        if (alpha < 0.02) discard;
        // Culoare sub pragul de bloom (0.3 luminanta) ca sa nu declanseze
        // UnrealBloomPass sa amplifice particulele pana la alb.
        vec3 color = vec3(0.32, 0.52, 0.72);
        gl_FragColor = vec4(color, alpha);
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
    let points = null;
    let material = null;
    let lastT = null;

    const group = new THREE.Group();
    group.name = 'wind-particles';
    group.visible = false;
    earthGroup.add(group);

    function buildPoints() {
        const count = gridSize * gridSize;
        const positions = new Float32Array(count * 3); // neutilizat de shader, dar necesar pentru geometrie valida
        const uvs = new Float32Array(count * 2);
        let i = 0;
        for (let row = 0; row < gridSize; row++) {
            for (let col = 0; col < gridSize; col++) {
                uvs[i * 2] = (col + 0.5) / gridSize;
                uvs[i * 2 + 1] = (row + 0.5) / gridSize;
                i++;
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));

        material = new THREE.ShaderMaterial({
            uniforms: {
                uPositionTexture: { value: null },
                uRadius: { value: 2.06 },
                uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
                uOpacity: { value: 0.7 },
            },
            vertexShader: POINTS_VERTEX_SHADER,
            fragmentShader: POINTS_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            // NormalBlending (nu Additive): particulele care se suprapun nu se
            // acumuleaza pana la alb. Cu 16k particule, Additive + bloom umplea
            // tot ecranul cu alb.
            blending: THREE.NormalBlending,
        });

        points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = 6;
        group.add(points);
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
            data[i * 4 + 2] = Math.random(); // age initial, esalonat, ca sa nu respawn-eze toate deodata
            data[i * 4 + 3] = 1;
        }

        positionVariable = gpuCompute.addVariable('texturePosition', POSITION_COMPUTE_SHADER, positionTexture);
        gpuCompute.setVariableDependencies(positionVariable, [positionVariable]);
        positionVariable.material.uniforms.uWindMap = { value: windTexture };
        positionVariable.material.uniforms.uMaxSpeed = { value: windTexture.userData.maxSpeedMs };
        positionVariable.material.uniforms.uDeltaTime = { value: 0 };
        positionVariable.material.uniforms.uSpeedScale = { value: 22 };
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
            buildPoints();
            group.add(points);
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

    // t: elapsed seconds since scene start (same absolute clock every other
    // system in the render loop uses - app-runtime.js's animate() passes
    // clock.getElapsedTime(), not a per-frame delta), delta computed here.
    function update(t) {
        if (!ready || !enabled || disposed) return;
        if (lastT === null) lastT = t;
        const dt = Math.min(0.25, Math.max(0, t - lastT));
        lastT = t;
        positionVariable.material.uniforms.uDeltaTime.value = dt;
        positionVariable.material.uniforms.uTime.value = t;
        gpuCompute.compute();
        material.uniforms.uPositionTexture.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
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
        points?.geometry?.dispose();
        material?.dispose();
        earthGroup.remove(group);
    }

    return { setEnabled, update, getStatus, dispose };
}
