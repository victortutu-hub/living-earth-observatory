const NOCTILUCENT_VERT = `
varying vec3 vLocalDir;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
    vLocalDir = normalize(position);
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NOCTILUCENT_FRAG = `
precision highp float;

uniform vec3 uSunDirLocal;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uNorthSeason;
uniform float uSouthSeason;
uniform float uIntensity;
uniform float uCinematic;
uniform float uEnabled;

varying vec3 vLocalDir;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(97.13, 311.79))) * 43758.5453);
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
    v += noise(p) * 0.52;
    v += noise(p * 2.15 + 19.0) * 0.31;
    v += noise(p * 5.10 - 7.0) * 0.17;
    return v;
}

void main() {
    if (uEnabled < 0.5) discard;

    vec3 localDir = normalize(vLocalDir);
    vec3 sunDir = normalize(uSunDirLocal);
    vec3 viewDir = normalize(uCamPos - vWorldPos);

    float lat = degrees(asin(clamp(localDir.y, -1.0, 1.0)));
    float bandWidth = mix(5.1, 6.6, uCinematic);
    float northLat = abs(lat - 62.0);
    float southLat = abs((-lat) - 62.0);
    float northBand = exp(-pow(northLat / bandWidth, 2.0)) * smoothstep(50.0, 55.0, lat) * (1.0 - smoothstep(69.0, 73.0, lat));
    float southBand = exp(-pow(southLat / bandWidth, 2.0)) * smoothstep(50.0, 55.0, -lat) * (1.0 - smoothstep(69.0, 73.0, -lat));
    float seasonalBand = northBand * uNorthSeason + southBand * uSouthSeason;

    // V3.5 - refractie atmosferica: Soarele ramane vizibil ~0.567 grade
    // (34 arcminute, valoarea standard de refractie astronomica la orizont)
    // dupa ce a coborat geometric sub linia locala. Fara aceasta corectie,
    // ferestrele de vizibilitate NLC (legate strict de altitudinea reala a
    // Soarelui din literatura) ar fi usor decalate fata de conditiile reale.
    float sunAltitude = asin(clamp(dot(localDir, sunDir), -1.0, 1.0)) + radians(0.567);
    float lowerTwilight = smoothstep(radians(-20.0), radians(-13.0), sunAltitude);
    float upperTwilight = 1.0 - smoothstep(radians(-2.5), radians(1.0), sunAltitude);
    float twilight = lowerTwilight * upperTwilight;

    float limbRaw = 1.0 - abs(dot(normalize(vWorldNormal), viewDir));
    float limb = 0.10 + pow(clamp(limbRaw, 0.0, 1.0), 1.72) * 0.90;
    float lon = atan(localDir.z, localDir.x);
    float lat01 = lat / 90.0;

    float streaks = fbm(vec2(lon * 8.0 + uTime * 0.020, lat01 * 20.0));
    float filamentEdge = mix(0.56, 0.47, uCinematic);
    float filamentTop = mix(0.88, 0.82, uCinematic);
    float filaments = smoothstep(filamentEdge, filamentTop, streaks);
    float comb = 0.62 + 0.38 * sin(lon * 38.0 + lat01 * 23.0 + uTime * 0.08);
    filaments *= mix(0.46, 1.05, comb);

    float alpha = seasonalBand * twilight * limb * filaments * mix(0.115, 0.185, uCinematic) * uIntensity;
    alpha = min(alpha, mix(0.052, 0.092, uCinematic));

    vec3 electricBlue = vec3(0.44, 0.70, 1.00);
    vec3 iceWhite = vec3(0.86, 0.94, 1.00);
    vec3 color = mix(electricBlue, iceWhite, smoothstep(0.42, 0.90, streaks));

    gl_FragColor = vec4(color * mix(1.18, 1.36, uCinematic), alpha);
}`;

function seasonalState(date = new Date()) {
    const month = date.getUTCMonth();
    return {
        north: month >= 5 && month <= 7,
        south: month === 11 || month <= 1
    };
}

function updateNoctilucentStatus(state) {
    const button = document.getElementById('noctilucentCloudBtn');
    const status = document.getElementById('noctilucentCloudStatus');
    if (button) button.textContent = `Noctilucent: ${state.enabled ? 'on' : 'off'}`;
    if (!status) return;
    status.dataset.state = state.enabled ? 'on' : 'off';
    if (!state.enabled) {
        status.textContent = 'Noctilucent: off';
        return;
    }
    const presetLabel = state.preset === 'cinematic' ? 'cinematic' : 'scientific';
    const intensityLabel = `${state.intensity.toFixed(1)}x`;
    if (state.northSeason && state.southSeason) {
        status.textContent = `Noctilucent: ${presetLabel} ${intensityLabel}, north/south twilight windows`;
    } else if (state.northSeason) {
        status.textContent = `Noctilucent: ${presetLabel} ${intensityLabel}, northern summer twilight`;
    } else if (state.southSeason) {
        status.textContent = `Noctilucent: ${presetLabel} ${intensityLabel}, southern summer twilight`;
    } else {
        status.dataset.state = 'pending';
        status.textContent = `Noctilucent: ${presetLabel} ${intensityLabel}, out of seasonal window`;
    }
}

function createStatusThrottle(updateStatus, intervalMs = 1000) {
    let lastSignature = '';
    let lastAt = 0;
    return function updateStatusThrottled(state, force = false) {
        const now = performance.now();
        const signature = [
            state.enabled,
            state.preset,
            state.intensity.toFixed(2),
            state.northSeason,
            state.southSeason
        ].join('|');
        if (!force && signature === lastSignature && now - lastAt < intervalMs) return;
        lastSignature = signature;
        lastAt = now;
        updateStatus(state);
    };
}

export function createNoctilucentCloudSystem({
    THREE,
    earthGroup,
    sunLight,
    intensity = 1.0,
    preset = 'scientific'
}) {
    const seasons = seasonalState();
    const state = {
        enabled: false,
        intensity,
        preset,
        northSeason: seasons.north,
        southSeason: seasons.south
    };

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uSunDirLocal: { value: new THREE.Vector3(1, 0, 0) },
            uCamPos: { value: new THREE.Vector3(0, 0, 6.4) },
            uTime: { value: 0 },
            uNorthSeason: { value: state.northSeason ? 1 : 0 },
            uSouthSeason: { value: state.southSeason ? 1 : 0 },
            uIntensity: { value: intensity },
            uCinematic: { value: preset === 'cinematic' ? 1 : 0 },
            uEnabled: { value: 0 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        vertexShader: NOCTILUCENT_VERT,
        fragmentShader: NOCTILUCENT_FRAG
    });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(2.032, 160, 96), material);
    mesh.name = 'earth-noctilucent-cloud-shell';
    mesh.visible = false;
    mesh.renderOrder = 6;
    earthGroup.add(mesh);

    const earthQuat = new THREE.Quaternion();
    const localSun = new THREE.Vector3();
    const updateStatusThrottled = createStatusThrottle(updateNoctilucentStatus);

    function refreshSeason() {
        const next = seasonalState();
        state.northSeason = next.north;
        state.southSeason = next.south;
        material.uniforms.uNorthSeason.value = state.northSeason ? 1 : 0;
        material.uniforms.uSouthSeason.value = state.southSeason ? 1 : 0;
    }

    function setEnabled(enabled) {
        state.enabled = Boolean(enabled);
        mesh.visible = state.enabled;
        material.uniforms.uEnabled.value = state.enabled ? 1 : 0;
        refreshSeason();
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
        refreshSeason();
        earthGroup.getWorldQuaternion(earthQuat).invert();
        localSun.copy(sunLight.position).normalize().applyQuaternion(earthQuat).normalize();
        material.uniforms.uSunDirLocal.value.copy(localSun);
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
