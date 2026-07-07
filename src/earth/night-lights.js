const NIGHT_LIGHTS_VERT = `
varying vec2 vUv;
varying vec3 vWorldNormal;
void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NIGHT_LIGHTS_FRAG = `
precision mediump float;
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uCityIntensity;
uniform float uCityTwilight;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec3 vWorldNormal;
void main() {
    vec3 city = texture2D(uMap, vUv).rgb;
    float sunDot = dot(normalize(vWorldNormal), normalize(uSunDir));
    float nightMask = 1.0 - smoothstep(-0.16, 0.08, sunDot);
    float cityMask = smoothstep(0.08, 0.72, max(max(city.r, city.g), city.b));
    float twilightLift = 1.0 - smoothstep(0.04, 0.36, abs(sunDot));
    float alpha = cityMask * (nightMask + twilightLift * uCityTwilight) * uOpacity;
    gl_FragColor = vec4(city * vec3(1.45, 1.22, 0.92) * uCityIntensity, alpha);
}`;

export function makeNightLightsMat({ THREE, texture }) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: texture },
            uOpacity: { value: 0.38 },
            uCityIntensity: { value: 1.0 },
            uCityTwilight: { value: 0.10 },
            uSunDir: { value: new THREE.Vector3(1, 0, 0) }
        },
        vertexShader: NIGHT_LIGHTS_VERT,
        fragmentShader: NIGHT_LIGHTS_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
}
