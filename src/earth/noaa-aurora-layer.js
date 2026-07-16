import { fetchEarthOvation } from './earth-data-runtime.js?v=unifiedEarth1';

function disposeObject3D(node) {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach(mat => mat.dispose?.());
    else node.material?.dispose?.();
}

function formatClock(timestamp) {
    if (!timestamp) return '--:--';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function parseCoordinates(data) {
    if (Array.isArray(data?.coordinates)) return data.coordinates;
    if (Array.isArray(data?.Coordinates)) return data.Coordinates;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        for (const value of Object.values(data)) {
            if (Array.isArray(value) && Array.isArray(value[0]) && value[0].length >= 3) return value;
            if (value && typeof value === 'object') {
                const nested = parseCoordinates(value);
                if (nested.length) return nested;
            }
        }
    }
    return [];
}

function normalizeLongitude(lon) {
    return ((lon + 540) % 360) - 180;
}

function ovalLatitude(latAbs, intensity) {
    const activity = Math.min(1, Math.max(0, intensity / 80));
    return 67 - activity * 8 + Math.sin(intensity * 0.07) * 1.4;
}

export function createNoaaAuroraLayer({
    THREE,
    earthGroup,
    lonLatToVec3,
    endpoint = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
    lonSegments = 180,
    latSegments = 10,
    bandHalfWidthDeg = 8,
    altitude = 2.185
}) {
    let activeController = null;
    let disposed = false;
    const group = new THREE.Group();
    group.name = 'noaa-aurora-oval-layer';
    group.visible = false;
    earthGroup.add(group);

    const uniforms = {
        uTime: { value: 0 },
        uOpacity: { value: 0.42 }
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexColors: true,
        vertexShader: `
            attribute float aIntensity;
            attribute float aBand;
            attribute float aHemisphere;
            varying vec3 vColor;
            varying float vIntensity;
            varying float vBand;
            varying float vFacing;
            uniform float uTime;
            void main() {
                vColor = color;
                vIntensity = aIntensity;
                float curtain = sin(uTime * 0.48 + position.x * 2.7 + position.z * 1.9) * 0.0035 * aIntensity;
                vec3 displaced = position + normalize(position) * curtain;
                vec3 worldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
                vec3 worldNormal = normalize(worldPos);
                vec3 viewDir = normalize(cameraPosition - worldPos);
                vFacing = smoothstep(-0.16, 0.42, dot(worldNormal, viewDir));
                vBand = aBand;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vIntensity;
            varying float vBand;
            varying float vFacing;
            uniform float uOpacity;
            uniform float uTime;
            void main() {
                float bandCore = smoothstep(1.0, 0.18, abs(vBand));
                float curtainTexture = 0.78 + 0.22 * sin(uTime * 1.1 + vBand * 6.0 + vIntensity * 5.0);
                float activity = smoothstep(0.015, 0.72, vIntensity);
                float alpha = bandCore * activity * curtainTexture * vFacing * uOpacity;
                if (alpha < 0.01) discard;
                vec3 oxygenGreen = vec3(0.42, 1.0, 0.56);
                vec3 oxygenRed = vec3(1.0, 0.28, 0.18);
                vec3 colorMix = mix(oxygenGreen, oxygenRed, smoothstep(0.62, 1.0, vIntensity) * 0.18);
                gl_FragColor = vec4(mix(colorMix, vColor, 0.35), alpha);
            }
        `
    });

    let meshes = [];
    let enabled = false;
    let loading = false;
    let lastCount = 0;
    let lastActiveCount = 0;
    let lastUpdated = null;
    let lastError = null;
    let northSamples = new Map();
    let southSamples = new Map();

    function readCoordinate(row) {
        if (Array.isArray(row)) {
            const a = Number(row[0]);
            const b = Number(row[1]);
            const c = Number(row[2]);
            if (Math.abs(a) <= 90 && Math.abs(b) > 90) return { lon: b, lat: a, intensity: c };
            if (Math.abs(b) < 45 && Math.abs(c) >= 45 && Math.abs(c) <= 90) return { lon: a, lat: c, intensity: b };
            return { lon: a, lat: b, intensity: c };
        }
        if (row && typeof row === 'object') {
            const lon = Number(row.lon ?? row.lng ?? row.longitude ?? row.Longitude);
            const lat = Number(row.lat ?? row.latitude ?? row.Latitude);
            const intensity = Number(row.intensity ?? row.aurora ?? row.Aurora ?? row.value ?? row.Value);
            return { lon, lat, intensity };
        }
        return { lon: NaN, lat: NaN, intensity: NaN };
    }

    function clear() {
        meshes.forEach(mesh => {
            group.remove(mesh);
            disposeObject3D(mesh);
        });
        meshes = [];
    }

    function sampleBin(lon) {
        return Math.round((normalizeLongitude(lon) + 180) / 2) * 2 - 180;
    }

    function ingest(data) {
        northSamples = new Map();
        southSamples = new Map();
        let accepted = 0;
        let active = 0;
        for (const row of parseCoordinates(data)) {
            const { lon, lat, intensity } = readCoordinate(row);
            if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(intensity)) continue;
            if (Math.abs(lat) < 45) continue;

            const bin = sampleBin(lon);
            const target = lat >= 0 ? northSamples : southSamples;
            const current = target.get(bin) || { intensity: 0, latAbs: 0, count: 0 };
            current.intensity = Math.max(current.intensity, intensity, 2.4);
            current.latAbs += Math.abs(lat);
            current.count += 1;
            target.set(bin, current);
            accepted++;
            if (intensity > 0) active++;
        }
        lastActiveCount = active;
        return accepted;
    }

    function intensityAt(samples, lon) {
        const bin = sampleBin(lon);
        const direct = samples.get(bin);
        if (direct) return direct.intensity;
        const left = samples.get(sampleBin(bin - 2))?.intensity || 0;
        const right = samples.get(sampleBin(bin + 2))?.intensity || 0;
        return Math.max(left, right) * 0.62;
    }

    function colorFor(hemisphere, intensity) {
        const activity = Math.min(1, Math.max(0, intensity / 80));
        const green = new THREE.Color(0x65ff9a);
        const cyan = new THREE.Color(0x8defff);
        const red = new THREE.Color(0xff5f3f);
        return green.clone()
            .lerp(cyan, hemisphere > 0 ? 0.16 : 0.28)
            .lerp(red, activity * 0.08);
    }

    function buildOvalMesh(hemisphere, samples) {
        const positions = [];
        const colors = [];
        const intensities = [];
        const bands = [];
        const hemispheres = [];
        const indices = [];
        const lonStep = 360 / lonSegments;

        for (let i = 0; i <= lonSegments; i++) {
            const lon = -180 + i * lonStep;
            const intensity = intensityAt(samples, lon);
            const centerAbs = ovalLatitude(66, intensity);
            const normalizedIntensity = Math.min(1, Math.max(0, intensity / 80));
            const width = bandHalfWidthDeg * (0.55 + normalizedIntensity * 0.72);
            for (let j = 0; j <= latSegments; j++) {
                const band = (j / latSegments) * 2 - 1;
                const latAbs = centerAbs + band * width;
                const lat = hemisphere * Math.min(88, Math.max(45, latAbs));
                const pos = lonLatToVec3(lon, lat, altitude + normalizedIntensity * 0.045);
                const color = colorFor(hemisphere, intensity);
                positions.push(pos.x, pos.y, pos.z);
                colors.push(color.r, color.g, color.b);
                intensities.push(normalizedIntensity);
                bands.push(band);
                hemispheres.push(hemisphere);
            }
        }

        const row = latSegments + 1;
        for (let i = 0; i < lonSegments; i++) {
            for (let j = 0; j < latSegments; j++) {
                const a = i * row + j;
                const b = (i + 1) * row + j;
                const c = (i + 1) * row + j + 1;
                const d = i * row + j + 1;
                indices.push(a, b, d, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('aIntensity', new THREE.Float32BufferAttribute(intensities, 1));
        geometry.setAttribute('aBand', new THREE.Float32BufferAttribute(bands, 1));
        geometry.setAttribute('aHemisphere', new THREE.Float32BufferAttribute(hemispheres, 1));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        return mesh;
    }

    function rebuild() {
        clear();
        const north = buildOvalMesh(1, northSamples);
        const south = buildOvalMesh(-1, southSamples);
        meshes = [north, south];
        meshes.forEach(mesh => group.add(mesh));
    }

    async function load() {
        if (disposed) return;
        loading = true;
        lastError = null;
        const controller = new AbortController();
        activeController = controller;
        try {
            const result = await fetchEarthOvation(endpoint, { signal: controller.signal });
            const data = result.data;
            if (disposed) return;
            lastCount = ingest(data);
            rebuild();
            lastUpdated = Date.parse(result.meta.sourceTime) || Date.now();
        } catch (error) {
            lastError = error;
            clear();
        } finally {
            if (activeController === controller) activeController = null;
            loading = false;
        }
    }

    async function setEnabled(value) {
        if (disposed) return;
        enabled = Boolean(value);
        group.visible = enabled;
        if (enabled && !meshes.length && !loading) await load();
        if (!enabled) clear();
    }

    function update(t) {
        uniforms.uTime.value = t;
    }

    function getStatus() {
        if (loading) return { enabled, loading, state: 'refreshing', message: 'Aurora: loading NOAA OVATION...' };
        if (lastError) return { enabled, loading, state: 'error', message: `Aurora: ${lastError.message || 'network error'}` };
        if (!enabled) return { enabled, loading, state: 'off', message: 'Aurora: NOAA OVATION off' };
        return {
            enabled,
            loading,
            state: 'on',
            message: lastActiveCount > 0
                ? `Aurora: oval from ${lastActiveCount}/${lastCount} active NOAA cells, updated ${formatClock(lastUpdated)}`
                : `Aurora: quiet oval from ${lastCount} NOAA polar cells, updated ${formatClock(lastUpdated)}`
        };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        activeController?.abort();
        activeController = null;
        clear();
        material.dispose();
        earthGroup.remove(group);
    }

    return {
        setEnabled,
        update,
        getStatus,
        dispose
    };
}
