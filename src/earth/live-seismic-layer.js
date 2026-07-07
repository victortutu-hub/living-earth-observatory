function disposeObject3D(node) {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach(mat => mat.dispose?.());
    else node.material?.dispose?.();
}

function depthColor(THREE, depthKm) {
    const shallow = new THREE.Color(0x8ff7ff);
    const middle = new THREE.Color(0x57a6ff);
    const deep = new THREE.Color(0xb58cff);
    const clamped = Math.max(0, Math.min(700, Number(depthKm) || 0));
    if (clamped < 70) return shallow.lerp(middle, clamped / 70);
    return middle.lerp(deep, Math.min(1, (clamped - 70) / 430));
}

function formatClock(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function createLiveSeismicLayer({
    THREE,
    earthGroup,
    lonLatToVec3,
    endpoint = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'
}) {
    const group = new THREE.Group();
    group.name = 'live-seismic-layer';
    earthGroup.add(group);

    const uniforms = {
        uTime: { value: 0 },
        uOpacity: { value: 0.82 },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) }
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            attribute float aSize;
            attribute float aPhase;
            attribute float aAge;
            varying vec3 vColor;
            varying float vAlpha;
            varying float vFacing;
            uniform float uTime;
            uniform float uPixelRatio;
            void main() {
                vColor = color;
                float pulse = 0.82 + 0.18 * sin(uTime * 3.1 + aPhase);
                float freshness = 1.0 - clamp(aAge / 24.0, 0.0, 0.74);
                vAlpha = freshness * (0.7 + 0.3 * pulse);
                vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                vec3 worldNormal = normalize(worldPos);
                vec3 viewDir = normalize(cameraPosition - worldPos);
                vFacing = smoothstep(-0.08, 0.28, dot(worldNormal, viewDir));
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * pulse * freshness * uPixelRatio * (300.0 / max(90.0, -mvPosition.z));
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vAlpha;
            varying float vFacing;
            uniform float uOpacity;
            void main() {
                vec2 p = gl_PointCoord - 0.5;
                float d = length(p) * 2.0;
                float ring = smoothstep(0.74, 0.5, d) * smoothstep(0.26, 0.5, d);
                float core = smoothstep(0.2, 0.0, d);
                float cross = smoothstep(0.085, 0.0, abs(p.x)) * smoothstep(0.48, 0.06, abs(p.y));
                cross += smoothstep(0.085, 0.0, abs(p.y)) * smoothstep(0.48, 0.06, abs(p.x));
                float halo = smoothstep(1.0, 0.26, d) * 0.16;
                float alpha = (ring * 0.82 + core * 0.9 + cross * 0.24 + halo) * vAlpha * vFacing * uOpacity;
                if (alpha < 0.02) discard;
                gl_FragColor = vec4(vColor, alpha);
            }
        `,
        vertexColors: true
    });

    let points = null;
    let enabled = false;
    let loading = false;
    let lastCount = 0;
    let lastUpdated = null;
    let lastError = null;

    function clear() {
        if (points) {
            group.remove(points);
            disposeObject3D(points);
            points = null;
        }
        lastCount = 0;
    }

    function buildGeometry(features) {
        const positions = [];
        const colors = [];
        const sizes = [];
        const phases = [];
        const ages = [];
        const now = Date.now();

        for (const feature of features) {
            const coords = feature?.geometry?.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) continue;
            const [lon, lat, depthKm = 0] = coords;
            const mag = Number(feature?.properties?.mag);
            const time = Number(feature?.properties?.time);
            if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(mag)) continue;
            if (mag < 0.5) continue;

            const pos = lonLatToVec3(lon, lat, 2.12 + Math.min(0.032, Math.max(0, mag) * 0.005));
            const color = depthColor(THREE, depthKm);
            const ageHours = Number.isFinite(time) ? Math.max(0, (now - time) / 36e5) : 12;
            const size = 11 + Math.pow(Math.max(0.1, mag), 1.55) * 5.2;

            positions.push(pos.x, pos.y, pos.z);
            colors.push(color.r, color.g, color.b);
            sizes.push(size);
            phases.push(Math.random() * Math.PI * 2);
            ages.push(ageHours);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
        geometry.setAttribute('aAge', new THREE.Float32BufferAttribute(ages, 1));
        return geometry;
    }

    async function load() {
        loading = true;
        lastError = null;
        try {
            const response = await fetch(`${endpoint}?cache=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`USGS ${response.status}`);
            const data = await response.json();
            const geometry = buildGeometry(Array.isArray(data.features) ? data.features : []);
            clear();
            points = new THREE.Points(geometry, material);
            points.frustumCulled = false;
            group.add(points);
            lastCount = geometry.getAttribute('position')?.count || 0;
            lastUpdated = Date.now();
        } catch (error) {
            lastError = error;
            clear();
        } finally {
            loading = false;
        }
    }

    async function setEnabled(nextEnabled) {
        enabled = Boolean(nextEnabled);
        group.visible = enabled;
        if (enabled && !points && !loading) await load();
        if (!enabled) clear();
    }

    async function toggle() {
        await setEnabled(!enabled);
    }

    function update(t) {
        uniforms.uTime.value = t;
    }

    function getStatus() {
        if (loading) return { enabled, loading, state: 'refreshing', message: 'USGS quakes: loading 24h feed...' };
        if (lastError) return { enabled, loading, state: 'error', message: `USGS quakes: ${lastError.message || 'network error'}` };
        if (!enabled) return { enabled, loading, state: 'off', message: 'USGS quakes: 24h layer off' };
        const time = lastUpdated ? formatClock(lastUpdated) : '--:--';
        return { enabled, loading, state: 'on', message: `USGS quakes: ${lastCount} in last 24h, updated ${time}` };
    }

    function dispose() {
        clear();
        material.dispose();
        earthGroup.remove(group);
    }

    group.visible = false;

    return {
        toggle,
        setEnabled,
        load,
        update,
        getStatus,
        dispose
    };
}
