const CLOUD_VERT = `
varying vec2 vUv;
varying float vLat;
varying vec3 vWorldNormal;
void main() {
    vUv = uv;
    vLat = normalize(position).y;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CLOUD_FRAG = `
precision mediump float;
uniform sampler2D uMap;
uniform sampler2D uMapNew;
uniform float uTime;
uniform float uCrossfade;
uniform float uOpacity;
uniform float uCloudNight;
uniform float uCloudTwilight;
uniform float uDriftScale;
uniform float uMorphScale;
uniform vec3 uSunDir;
varying vec2 vUv;
varying float vLat;
varying vec3 vWorldNormal;

float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float nm(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*nm(p);p=p*2.1+vec2(1.7,9.2);a*=0.5;}return v;}

void main() {
    float absLat = abs(vLat);
    float jet = exp(-pow((absLat - 0.52)*4.0, 2.0));

    vec2 uv = vUv;

    float oscil = sin(uTime * 0.07 + vLat * 5.0) * (0.003 + jet * 0.004) * uDriftScale;
    uv.x += oscil;

    vec2 t = uv * 2.2;
    uv += vec2(
        (fbm(t + vec2(uTime*0.004, 0.0)) - 0.5) * 0.007,
        (fbm(t + vec2(0.0, uTime*0.003) + 5.2) - 0.5) * 0.004
    ) * uMorphScale;

    vec4 c = texture2D(uMap, uv);
    if (uCrossfade > 0.001) c = mix(c, texture2D(uMapNew, uv), clamp(uCrossfade, 0.0, 1.0));

    float slowA = fbm(uv * 3.0 + vec2(uTime * 0.006, -uTime * 0.004));
    float slowB = fbm(uv * 7.5 + vec2(-uTime * 0.004, uTime * 0.005) + 11.7);
    float densityBreath = (slowA - 0.5) * 0.14 + (slowB - 0.5) * 0.06;
    float edge = smoothstep(0.02, 0.34, c.a);
    float erosion = (slowB - 0.5) * (1.0 - edge) * 0.22;
    float alphaMorph = (densityBreath - erosion) * uMorphScale;
    c.a = clamp(c.a + alphaMorph, 0.0, 1.0);
    c.rgb *= mix(0.92, 1.08, slowA * uMorphScale + (1.0 - uMorphScale) * 0.5);

    // V3.5 - refractie atmosferica (vezi earth-material.js/atmosphere.js).
    float sunDot = dot(normalize(vWorldNormal), normalize(uSunDir)) + 0.0099;
    float dayMask = smoothstep(-0.10, 0.24, sunDot);
    float twilight = 1.0 - smoothstep(0.00, 0.34, abs(sunDot));
    vec3 litCloud = c.rgb * mix(vec3(0.10, 0.14, 0.22), vec3(1.0), dayMask);
    litCloud = mix(litCloud, litCloud * vec3(1.20, 0.84, 0.58), twilight * uCloudTwilight);
    gl_FragColor = vec4(litCloud, c.a * uOpacity * mix(uCloudNight, 1.0, dayMask));
}`;

export function createCloudFallbackTexture(THREE) {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
}

export function makeCloudMat({ THREE, texture, opacity, fallbackTexture }) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uMap:       { value: texture },
            uMapNew:    { value: fallbackTexture },
            uTime:      { value: 0 },
            uCrossfade: { value: 0 },
            uOpacity:   { value: opacity },
            uCloudNight: { value: 0.46 },
            uCloudTwilight: { value: 0.24 },
            uDriftScale: { value: 1.0 },
            uMorphScale: { value: 1.0 },
            uSunDir:    { value: new THREE.Vector3(1, 0, 0) }
        },
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
    });
}
