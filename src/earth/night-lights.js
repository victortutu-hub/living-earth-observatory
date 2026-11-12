import { ATMOSPHERE, ATMOSPHERE_GLSL } from './atmosphere-physics.js';

const NIGHT_LIGHTS_VERT = `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NIGHT_LIGHTS_FRAG = `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uCityIntensity;
uniform float uCityTwilight;
uniform vec3 uSunDir;
uniform float uAerialPerspective;
uniform float uAtmosphereHaze;
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
${ATMOSPHERE_GLSL}
void main() {
    vec3 city = texture2D(uMap, vUv).rgb;
    // Match the refraction-adjusted terminator used by Earth, clouds and
    // atmosphere. The +0.0099 term is about 0.567 degrees at the horizon.
    float sunDotRefracted = dot(normalize(vWorldNormal), normalize(uSunDir)) + 0.0099;
    float nightMask = 1.0 - smoothstep(-0.15, 0.10, sunDotRefracted);
    float cityMask = smoothstep(0.08, 0.72, max(max(city.r, city.g), city.b));
    float twilightLift = 1.0 - smoothstep(0.04, 0.36, abs(sunDotRefracted));
    float alpha = cityMask * (nightMask + twilightLift * uCityTwilight) * uOpacity;
    vec3 light = city * vec3(1.45, 1.22, 0.92) * uCityIntensity;
    // City light crosses the same air column as the surface: attenuated toward
    // the limb (extinction only; emitted light, no added scattering).
    if (uAerialPerspective > 0.5) light *= atmoViewTransmittance(vWorldPos, cameraPosition, uAtmosphereHaze);
    gl_FragColor = vec4(light, alpha);
}`;

export function makeNightLightsMat({ THREE, texture }) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: texture },
            uOpacity: { value: 0.38 },
            uCityIntensity: { value: 1.0 },
            uCityTwilight: { value: 0.10 },
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uAerialPerspective: { value: 1.0 },
            uAtmosphereHaze: { value: ATMOSPHERE.haze }
        },
        vertexShader: NIGHT_LIGHTS_VERT,
        fragmentShader: NIGHT_LIGHTS_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
}
