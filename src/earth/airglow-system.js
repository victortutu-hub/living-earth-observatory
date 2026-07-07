const AIRGLOW_VERT = `
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vLocalPos;
void main() {
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vLocalPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const AIRGLOW_FRAG = `
precision highp float;

const float AIRGLOW_RADIUS = 2.032;

uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uIntensity;
uniform float uCinematic;
uniform float uEnabled;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vLocalPos;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float softNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

void main() {
    if (uEnabled < 0.5) discard;

    vec3 normal = normalize(vWorldNormal);
    vec3 viewDir = normalize(uCamPos - vWorldPos);
    vec3 sunDir = normalize(uSunDir);

    // V3.5 - refractie atmosferica (vezi earth-material.js/atmosphere.js).
    float sunDot = dot(normal, sunDir) + 0.0099;
    float night = smoothstep(0.12, -0.26, sunDot);
    float terminator = 1.0 - smoothstep(0.00, 0.34, abs(sunDot));
    float viewFacing = clamp(dot(normal, viewDir), 0.0, 1.0);
    float limbRaw = 1.0 - viewFacing;
    float limb = pow(clamp(limbRaw, 0.0, 1.0), mix(4.8, 3.35, uCinematic));
    float diskTrace = night * pow(viewFacing, 1.85) * (0.0016 + 0.0018 * uCinematic);
    float limbSheet = night * pow(clamp(limbRaw, 0.0, 1.0), mix(2.35, 1.85, uCinematic));
    float nightSheet = diskTrace + limbSheet * (0.010 + 0.011 * uCinematic);

    float lat = clamp(vLocalPos.y / AIRGLOW_RADIUS, -1.0, 1.0);
    float equatorialBias = 0.68 + 0.32 * (1.0 - abs(lat));
    float polarFade = smoothstep(1.0, 0.62, abs(lat));

    float n1 = softNoise(vec2(atan(vLocalPos.z, vLocalPos.x) * 2.4 + uTime * 0.018, lat * 5.8));
    float n2 = softNoise(vec2(atan(vLocalPos.z, vLocalPos.x) * 5.7 - uTime * 0.010, lat * 9.2 + 11.0));
    float texture = mix(0.82, 1.08, n1 * 0.65 + n2 * 0.35);

    vec3 oxygenGreen = vec3(0.20, 0.90, 0.52);
    vec3 oxygenRed = vec3(0.82, 0.18, 0.14);
    vec3 sodiumGold = vec3(0.96, 0.68, 0.28);
    vec3 color = oxygenGreen * 0.90 + sodiumGold * 0.075 + oxygenRed * 0.025;
    color = mix(color, oxygenGreen * 0.93 + sodiumGold * 0.052 + oxygenRed * 0.018, smoothstep(0.50, 0.92, abs(lat)) * 0.28);
    color += oxygenRed * limb * night * terminator * mix(0.0035, 0.009, uCinematic);

    float sheetAlpha = nightSheet * mix(0.58, 0.82, uCinematic);
    float limbAlpha = limb * night * (0.0032 + terminator * mix(0.0018, 0.0045, uCinematic));
    float alpha = (sheetAlpha + limbAlpha) * equatorialBias * polarFade;
    alpha *= texture * uIntensity;
    alpha = min(alpha, mix(0.009, 0.022, uCinematic));

    gl_FragColor = vec4(color * mix(1.08, 1.22, uCinematic), alpha);
}`;

function updateAirglowStatus(state) {
    const button = document.getElementById('airglowLayerBtn');
    const status = document.getElementById('airglowStatus');
    if (button) button.textContent = `Airglow: ${state.enabled ? 'on' : 'off'}`;
    if (!status) return;
    status.dataset.state = state.enabled ? 'on' : 'off';
    status.textContent = state.enabled
        ? `Airglow: ${state.preset} ${state.intensity.toFixed(1)}x - real OI emission, procedural intensity`
        : 'Airglow: off';
}

function createStatusThrottle(updateStatus, intervalMs = 1000) {
    let lastSignature = '';
    let lastAt = 0;
    return function updateStatusThrottled(state, force = false) {
        const now = performance.now();
        const signature = `${state.enabled}|${state.preset}|${state.intensity.toFixed(2)}`;
        if (!force && signature === lastSignature && now - lastAt < intervalMs) return;
        lastSignature = signature;
        lastAt = now;
        updateStatus(state);
    };
}

export function createAirglowSystem({
    THREE,
    earthGroup,
    sunLight,
    intensity = 1.0,
    preset = 'scientific'
}) {
    const state = {
        enabled: false,
        intensity,
        preset
    };

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uCamPos: { value: new THREE.Vector3(0, 0, 6.4) },
            uTime: { value: 0 },
            uIntensity: { value: intensity },
            uCinematic: { value: preset === 'cinematic' ? 1 : 0 },
            uEnabled: { value: 0 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        vertexShader: AIRGLOW_VERT,
        fragmentShader: AIRGLOW_FRAG
    });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(2.032, 128, 80), material);
    mesh.name = 'earth-airglow-shell';
    mesh.visible = false;
    mesh.renderOrder = 4;
    earthGroup.add(mesh);
    const updateStatusThrottled = createStatusThrottle(updateAirglowStatus);

    function setEnabled(enabled) {
        state.enabled = Boolean(enabled);
        mesh.visible = state.enabled;
        material.uniforms.uEnabled.value = state.enabled ? 1 : 0;
        updateStatusThrottled(state, true);
    }

    function setIntensity(value) {
        state.intensity = Math.max(0.25, Math.min(2.4, Number(value) || 1));
        material.uniforms.uIntensity.value = state.intensity;
        updateStatusThrottled(state, true);
    }

    function setPreset(value) {
        state.preset = value === 'cinematic' ? 'cinematic' : 'scientific';
        material.uniforms.uCinematic.value = state.preset === 'cinematic' ? 1 : 0;
        updateStatusThrottled(state, true);
    }

    function toggle() {
        setEnabled(!state.enabled);
    }

    function update(camera, t) {
        if (!state.enabled) return;
        material.uniforms.uSunDir.value.copy(sunLight.position).normalize();
        material.uniforms.uCamPos.value.copy(camera.position);
        material.uniforms.uTime.value = t;
        material.uniforms.uIntensity.value = state.intensity;
        material.uniforms.uCinematic.value = state.preset === 'cinematic' ? 1 : 0;
        updateStatusThrottled(state);
    }

    updateStatusThrottled(state, true);

    return {
        mesh,
        material,
        state,
        setEnabled,
        setIntensity,
        setPreset,
        toggle,
        update
    };
}
