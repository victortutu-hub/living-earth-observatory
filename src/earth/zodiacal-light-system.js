const ZODIACAL_VERT = `
varying vec3 vWorldDir;
void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}`;

const ZODIACAL_FRAG = `
precision highp float;

uniform vec3 uSunDir;
uniform float uTime;
uniform float uIntensity;
uniform float uEnabled;
varying vec3 vWorldDir;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.7, 289.3))) * 23143.473);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

float fbm(vec2 p) {
    float v = 0.0;
    v += noise(p) * 0.6;
    v += noise(p * 2.3 + 17.0) * 0.4;
    return v;
}

void main() {
    if (uEnabled < 0.5) discard;

    vec3 dir = normalize(vWorldDir);
    vec3 sunDir = normalize(uSunDir);

    float sunAngle = acos(clamp(dot(dir, sunDir), -1.0, 1.0));
    float antiSunAngle = acos(clamp(dot(dir, -sunDir), -1.0, 1.0));

    // In this scene the star field and solar vectors use an equatorial-like
    // frame. A 23.44 deg tilted normal approximates the ecliptic plane.
    vec3 eclipticNormal = normalize(vec3(0.0, cos(radians(23.44)), -sin(radians(23.44))));
    float eclipticLat = abs(asin(clamp(dot(dir, eclipticNormal), -1.0, 1.0)));
    float band = exp(-pow(eclipticLat / radians(11.5), 2.0));
    float eclipticCore = exp(-pow(eclipticLat / radians(3.4), 2.0));

    float forwardCone = exp(-pow(sunAngle / radians(26.0), 1.28));
    float eclipticSpine = eclipticCore * exp(-pow(sunAngle / radians(46.0), 1.15)) * 0.24;
    float gegenschein = exp(-pow(antiSunAngle / radians(7.5), 2.0)) * 0.065;
    float horizonCut = smoothstep(radians(92.0), radians(38.0), sunAngle);

    float grain = fbm(vec2(atan(dir.z, dir.x) * 2.8 + uTime * 0.004, dir.y * 7.5));
    float shimmer = mix(0.94, 1.06, grain);

    float alpha = ((forwardCone + eclipticSpine) * horizonCut + gegenschein) * band * shimmer * 0.095 * uIntensity;
    alpha = min(alpha, 0.085);

    vec3 warmDust = vec3(1.0, 0.82, 0.58);
    vec3 coolDust = vec3(0.52, 0.58, 0.72);
    float warmth = smoothstep(0.25, 0.88, forwardCone);
    vec3 color = mix(coolDust, warmDust, warmth);
    gl_FragColor = vec4(color * 0.95, alpha);
}`;

function updateZodiacalStatus(state) {
    const button = document.getElementById('zodiacalLightBtn');
    const status = document.getElementById('zodiacalLightStatus');
    if (button) button.textContent = `Zodiacal light: ${state.enabled ? 'on' : 'off'}`;
    if (!status) return;
    status.dataset.state = state.enabled ? 'on' : 'off';
    status.textContent = state.enabled
        ? 'Zodiacal light: solar dust glow on ecliptic'
        : 'Zodiacal light: off';
}

export function createZodiacalLightSystem({
    THREE,
    scene,
    sunLight,
    intensity = 0.72
}) {
    const state = {
        enabled: false,
        intensity
    };

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uTime: { value: 0 },
            uIntensity: { value: intensity },
            uEnabled: { value: 0 }
        },
        transparent: true,
        depthWrite: false,
        // depthTest ERA false - shell-ul (sfera R=90, in jurul intregii scene)
        // se randa mereu "peste" tot, inclusiv peste Luna/Pamantul deja randate,
        // fara sa verifice adancimea reala. Fiind aditiv, glow-ul se "picta"
        // peste partea intunecata a Lunii oricand directia de vizualizare
        // cadea intr-o zona cu alpha mare a shader-ului, indiferent ca Luna
        // era fizic "in fata" acelui fundal - de-aici umbra care disparea.
        // depthTest:true respecta corect obiectele opace deja randate.
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        vertexShader: ZODIACAL_VERT,
        fragmentShader: ZODIACAL_FRAG
    });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(90, 96, 64), material);
    mesh.name = 'zodiacal-light-dust-shell';
    mesh.visible = false;
    mesh.renderOrder = 10;
    scene.add(mesh);

    function setEnabled(enabled) {
        state.enabled = Boolean(enabled);
        mesh.visible = state.enabled;
        material.uniforms.uEnabled.value = state.enabled ? 1 : 0;
        updateZodiacalStatus(state);
    }

    function toggle() {
        setEnabled(!state.enabled);
    }

    function setIntensity(value) {
        const next = Number.isFinite(value) ? value : intensity;
        state.intensity = Math.max(0.35, Math.min(2.2, next));
        material.uniforms.uIntensity.value = state.intensity;
    }

    function update(_camera, t) {
        if (!state.enabled) return;
        material.uniforms.uSunDir.value.copy(sunLight.position).normalize();
        material.uniforms.uTime.value = t;
        material.uniforms.uIntensity.value = state.intensity;
    }

    updateZodiacalStatus(state);

    return {
        mesh,
        material,
        state,
        setEnabled,
        toggle,
        setIntensity,
        update
    };
}
