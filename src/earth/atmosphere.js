const ATMOSPHERE_VERT = `
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
    vNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ATMOSPHERE_FRAG = `
precision highp float;

uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform float uAtmosphereAlpha;
uniform float uSunsetAlpha;
uniform float uNightRim;
uniform float uAtmosphereMode;
uniform float uPhysicalIntensity;
uniform float uPhysicalHaze;
uniform float uOzoneStrength;
uniform float uSunsetBoost;
uniform float uHorizonLift;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

const float M_PER_UNIT = 3185500.0;
const float R_E = 6371000.0;
const float R_A = 6471000.0;
const vec3 BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const float H_R = 7994.0;
const float BETA_M = 21.0e-6;
const float H_M = 1200.0;
const float G_MIE = 0.76;
const int N_VIEW = 16;
const int N_SUN = 8;

vec2 hitSphere(vec3 ro, vec3 rd, float radius) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float d = b * b - c;
    if (d < 0.0) return vec2(-1.0);
    float s = sqrt(d);
    return vec2(-b - s, -b + s);
}

vec2 densityAt(vec3 p) {
    float h = max(0.0, length(p) - R_E);
    return vec2(exp(-h / H_R), exp(-h / H_M));
}

vec2 sunTau(vec3 p, vec3 sd) {
    vec2 earthHit = hitSphere(p, sd, R_E);
    if (earthHit.x > 0.0) return vec2(1e9);

    vec2 t = hitSphere(p, sd, R_A);
    float dt = max(0.0, t.y) / float(N_SUN);
    vec2 tau = vec2(0.0);
    for (int i = 0; i < N_SUN; i++) {
        float ti = (float(i) + 0.5) * dt;
        tau += densityAt(p + sd * ti) * dt;
    }
    return tau;
}

float phaseR(float mu) {
    return 0.75 * (1.0 + mu * mu);
}

float phaseM(float mu) {
    float g = G_MIE;
    float g2 = g * g;
    float denom = pow(max(0.0, 1.0 + g2 - 2.0 * g * mu), 1.5);
    return 0.5 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * denom);
}

vec4 simpleAtmosphere() {
    float facing = max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
    float rim = pow(1.0 - facing, 4.2);
    float soft = pow(1.0 - facing, 1.9);

    // V3.5 - refractie atmosferica: la orizont, Soarele ramane vizibil real
    // ~0.567 grade (34 arcminute) dupa ce a coborat geometric sub linia
    // locala - fara corectia asta, terminatorul e cu putin mai "devreme"
    // decat cel perceput real de un observator. 0.0099 e echivalentul in
    // spatiul produsului scalar (d(dot)/d(unghi) ≈ -1 langa terminator).
    float sunDot = -dot(normalize(vWorldNormal), normalize(uSunDir)) + 0.0099;
    float dayFactor = smoothstep(-0.12, 0.28, sunDot);

    float horizonGlow = 1.0 - smoothstep(0.00, 0.42, abs(sunDot));
    float sunsetFactor = pow(max(0.0, horizonGlow), 1.65) * smoothstep(-0.18, 0.18, sunDot);
    float nightRim = smoothstep(-0.46, -0.04, sunDot) * (1.0 - dayFactor);

    vec3 dayColor = vec3(0.17, 0.49, 0.96);
    vec3 sunsetColor = vec3(1.00, 0.48, 0.13);
    vec3 nightColor = vec3(0.018, 0.035, 0.11);

    vec3 color = mix(nightColor, mix(dayColor, sunsetColor, sunsetFactor * 0.78), dayFactor);
    color += vec3(0.05, 0.12, 0.34) * nightRim * uNightRim;

    float alpha = (rim * 0.12 + soft * 0.022) * (0.16 + dayFactor * 0.84);
    alpha += rim * sunsetFactor * 0.18 * uSunsetAlpha + rim * nightRim * 0.035 * uNightRim;
    // Arc subtire de amurg la limb, prezent mereu (chiar si in umbra deplina) -
    // fara el, alpha scade aproape la 0 pe partea de noapte si muchia sferei
    // devine o taietura bruta, opaca, vizibila ca un contur negru nenatural
    // ori de cate ori exista ceva luminos in spate (ex: zodiacal light).
    alpha += rim * 0.05 * uNightRim;
    alpha *= uAtmosphereAlpha;
    return vec4(color, alpha);
}

vec4 physicalAtmosphere() {
    vec3 ro = uCamPos * M_PER_UNIT;
    vec3 rd = normalize(vWorldPos - uCamPos);
    vec3 sd = normalize(uSunDir);

    vec2 tA = hitSphere(ro, rd, R_A);
    if (tA.y < 0.0) return vec4(0.0);

    vec2 tE = hitSphere(ro, rd, R_E);
    float tStart = max(0.0, tA.x);
    float tEnd = (tE.x > 0.0) ? min(tA.y, tE.x) : tA.y;
    if (tEnd <= tStart) return vec4(0.0);

    float dt = (tEnd - tStart) / float(N_VIEW);
    float mu = dot(rd, sd);
    float pR = phaseR(mu);
    float pM = phaseM(mu);

    vec3 sR = vec3(0.0);
    vec3 sM = vec3(0.0);
    vec2 tauV = vec2(0.0);

    for (int i = 0; i < N_VIEW; i++) {
        float ti = tStart + (float(i) + 0.5) * dt;
        vec3 sp = ro + rd * ti;
        vec2 dens = densityAt(sp) * dt;
        tauV += dens;

        vec2 tau = tauV + sunTau(sp, sd);
        vec3 transmittance = exp(-(BETA_R * tau.x + BETA_M * uPhysicalHaze * (tau.x + tau.y)));
        sR += dens.x * transmittance;
        sM += dens.y * transmittance;
    }

    vec3 sky = uPhysicalIntensity * (pR * BETA_R * sR + pM * BETA_M * uPhysicalHaze * sM);
    sky = 1.0 - exp(-sky);

    float terminator = 1.0 - smoothstep(0.02, 0.42, abs(dot(normalize(vWorldNormal), sd)));
    vec3 ozoneWarmth = vec3(1.0, 0.70, 0.46);
    sky = mix(sky, sky * ozoneWarmth + vec3(0.030, 0.010, 0.002) * uSunsetBoost, terminator * uOzoneStrength);
    sky += sqrt(max(sky, vec3(0.0))) * vec3(0.035, 0.060, 0.095) * terminator * uHorizonLift;
    sky *= uAtmosphereAlpha * 0.72;

    float alpha = clamp(dot(sky, vec3(0.33)) * 0.78, 0.0, 1.0);
    return vec4(sky, alpha);
}

void main() {
    gl_FragColor = uAtmosphereMode > 0.5 ? physicalAtmosphere() : simpleAtmosphere();
}`;

export function makeAtmosphereMat(THREE) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uCamPos: { value: new THREE.Vector3(0, 0, 6.4) },
            uAtmosphereAlpha: { value: 1.0 },
            uSunsetAlpha: { value: 1.0 },
            uNightRim: { value: 1.0 },
            uAtmosphereMode: { value: 0.0 },
            uPhysicalIntensity: { value: 16.0 },
            uPhysicalHaze: { value: 0.55 },
            uOzoneStrength: { value: 0.18 },
            uSunsetBoost: { value: 0.55 },
            uHorizonLift: { value: 0.10 }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        vertexShader: ATMOSPHERE_VERT,
        fragmentShader: ATMOSPHERE_FRAG
    });
}

export function setAtmosphereMode(atmosphereMat, mode) {
    if (!atmosphereMat?.uniforms?.uAtmosphereMode) return;
    atmosphereMat.uniforms.uAtmosphereMode.value = mode === 'physical' ? 1.0 : 0.0;
}
