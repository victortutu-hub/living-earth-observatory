export const vertexSource = `
  attribute vec2 aPosition;
  varying vec2 vUv;
  void main(){
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

export const fragmentSource = `
  precision highp float;

  varying vec2 vUv;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec2  uHover;
  uniform float uActive;
  uniform float uTransition;
  uniform float uMobile;
  uniform sampler2D uPortalTex0;
  uniform sampler2D uPortalTex1;
  uniform vec2 uPortalLoaded;
  uniform vec2 uPortalMaterials;
  uniform vec3 uPortalPrimary0;
  uniform vec3 uPortalPrimary1;
  uniform vec4 uPortalSignature0;
  uniform vec4 uPortalSignature1;
  uniform vec2 uParallax;
  uniform float uSkipFinish;
  uniform float uIntro;

  #define PI 3.14159265358979323846264
  #define TAU 6.28318530717958647692528

  float hash21(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec2 hash22(vec2 p){
    float n = sin(dot(p, vec2(41.0, 289.0)));
    return fract(vec2(262144.0, 32768.0) * n);
  }

  float noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p){
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.62, 1.12, -1.12, 1.62);
    for(int i=0;i<5;i++){
      v += a * noise(p);
      p = m * p + 17.0;
      a *= 0.5;
    }
    return v;
  }

  mat2 rot(float a){
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
  }

  vec3 rotateY(vec3 p, float a){
    float s = sin(a), c = cos(a);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  }

  vec3 rotateX(vec3 p, float a){
    float s = sin(a), c = cos(a);
    return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
  }

  float ringBand(float r, float radius, float w){
    return 1.0 - smoothstep(w, w * 1.7, abs(r - radius));
  }

  float ellipseBand(vec2 p, float rx, float ry, float w){
    float e = abs(length(vec2(p.x / rx, p.y / ry)) - 1.0);
    return 1.0 - smoothstep(w, w * 2.2, e);
  }

  float starField(vec2 p, float t){
    vec2 drift = vec2(t * 0.006, -t * 0.003);
    vec2 gp = p * 118.0 + drift * 60.0;
    vec2 id = floor(gp);
    vec2 gv = fract(gp) - 0.5;
    float rnd = hash21(id);
    vec2 off = hash22(id) - 0.5;
    float d = length(gv - off * 0.72);
    float sparse = step(0.972, rnd);
    float star = sparse * (1.0 - smoothstep(0.0, 0.055, d));
    float twinkle = 0.65 + 0.35 * sin(t * (1.2 + rnd * 4.0) + rnd * 20.0);
    return star * twinkle;
  }

  vec3 nebula(vec2 p, float t){
    float n1 = fbm(p * 1.15 + vec2(t * 0.012, -t * 0.006));
    float n2 = fbm(p * 2.2 - vec2(t * 0.008, t * 0.004));
    float band = smoothstep(0.28, 1.0, n1 * n2);
    vec3 cold = vec3(0.02, 0.09, 0.12);
    vec3 warm = vec3(0.12, 0.035, 0.16);
    return mix(cold, warm, smoothstep(-0.2, 0.6, p.x)) * band * 0.32;
  }

  vec3 background(vec2 p, float t, vec2 c0, vec2 c1, float r0, float r1){
    vec2 bp = p;
    vec2 q0 = bp - c0;
    vec2 q1 = bp - c1;
    float d0 = max(length(q0), 0.02);
    float d1 = max(length(q1), 0.02);
    float l0 = exp(-pow(abs(d0 - r0) * 5.0, 2.0)) * 0.010;
    float l1 = exp(-pow(abs(d1 - r1) * 5.0, 2.0)) * 0.010;
    bp += normalize(q0) * l0;
    bp += normalize(q1) * l1;

    float s = starField(bp, t);
    s += 0.35 * starField(bp * 1.7 + 17.0, t * 0.7);
    vec3 col = vec3(0.004, 0.004, 0.007) + nebula(bp, t);
    col += vec3(0.72, 0.82, 1.0) * s * 0.72;
    col += vec3(0.40, 0.70, 1.0) * s * s * 0.9;
    return col;
  }

  vec3 planetaryFallback(vec2 q, vec3 color, float t, float disc){
    float r = length(q);
    float a = atan(q.y, q.x);
    vec2 sphereUv = vec2(a / TAU + 0.5, r * 3.3);
    float n = fbm(vec2(sphereUv.x * 4.8 + t * 0.018, sphereUv.y * 1.8 - t * 0.015));
    float bands = sin(a * 5.0 + n * 6.0 + t * 0.26) * 0.5 + 0.5;
    float clouds = smoothstep(0.47, 0.84, fbm(q * 7.0 + vec2(t * 0.018, -t * 0.012)) + bands * 0.25);
    vec3 deep = vec3(0.005, 0.035, 0.052);
    vec3 cyan = color * 0.46;
    vec3 cloud = vec3(0.58, 0.96, 1.0);
    vec3 col = mix(deep, cyan, n * 0.65) * disc;
    col += cloud * clouds * disc * 0.22;
    col *= 1.0 - smoothstep(0.18, 0.255, r) * 0.52;
    col += color * ringBand(r, 0.247, 0.004) * 0.23;
    return col * disc;
  }

  vec3 planetaryCore0(vec2 q, vec3 color, float t){
    float coreRadius = 0.245;
    float r = length(q);
    float disc = 1.0 - smoothstep(coreRadius, coreRadius + 0.010, r);
    if(disc <= 0.0) return vec3(0.0);
    vec2 sphere = q / coreRadius;
    float rr = dot(sphere, sphere);
    if(rr > 1.0) return vec3(0.0);
    float z = sqrt(max(0.0, 1.0 - rr));
    vec3 n = normalize(vec3(sphere.x, sphere.y, z));
    n = rotateX(n, -0.22);
    n = rotateY(n, t * 0.10 + 0.85);
    float lon = atan(n.z, n.x);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    vec2 uv = vec2(lon / TAU + 0.5, 0.5 - lat / PI);
    vec3 tex = planetaryFallback(q, color, t, disc);
    if(uPortalLoaded.x > 0.5) tex = texture2D(uPortalTex0, uv).rgb;
    vec2 cloudUv = uv * vec2(6.5, 3.2) + vec2(t * 0.028, t * 0.006);
    float cloudN = fbm(cloudUv);
    float cloudN2 = fbm(cloudUv * 2.1 - vec2(t * 0.017, 0.0));
    float clouds = smoothstep(0.52, 0.86, cloudN * 0.65 + cloudN2 * 0.35);
    tex = mix(tex, vec3(0.92, 0.97, 1.0), clouds * 0.42);
    vec3 lightDir = normalize(vec3(-0.7, 0.5, 0.8));
    float diffuse = max(0.15, dot(n, lightDir));
    float fresnel = pow(1.0 - max(0.0, n.z), 3.5);
    vec3 atmosphere = vec3(0.22, 0.72, 1.0) * fresnel * 0.55;
    vec3 col = tex * (0.18 + diffuse * 1.05);
    col += atmosphere;
    col += vec3(0.9, 0.98, 1.0) * pow(max(0.0, dot(reflect(-lightDir, n), vec3(0.0, 0.0, 1.0))), 18.0) * 0.12;
    col *= disc;
    col += color * ringBand(r, coreRadius + 0.002, 0.004) * 0.22;
    return col;
  }

  vec3 planetaryCore1(vec2 q, vec3 color, float t){
    float coreRadius = 0.245;
    float r = length(q);
    float disc = 1.0 - smoothstep(coreRadius, coreRadius + 0.010, r);
    if(disc <= 0.0) return vec3(0.0);
    vec2 sphere = q / coreRadius;
    float rr = dot(sphere, sphere);
    if(rr > 1.0) return vec3(0.0);
    float z = sqrt(max(0.0, 1.0 - rr));
    vec3 n = normalize(vec3(sphere.x, sphere.y, z));
    n = rotateX(n, -0.22);
    n = rotateY(n, t * 0.10 + 0.85);
    float lon = atan(n.z, n.x);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    vec2 uv = vec2(lon / TAU + 0.5, 0.5 - lat / PI);
    vec3 tex = planetaryFallback(q, color, t, disc);
    if(uPortalLoaded.y > 0.5) tex = texture2D(uPortalTex1, uv).rgb;
    vec2 cloudUv = uv * vec2(6.5, 3.2) + vec2(t * 0.028, t * 0.006);
    float cloudN = fbm(cloudUv);
    float cloudN2 = fbm(cloudUv * 2.1 - vec2(t * 0.017, 0.0));
    float clouds = smoothstep(0.52, 0.86, cloudN * 0.65 + cloudN2 * 0.35);
    tex = mix(tex, vec3(0.92, 0.97, 1.0), clouds * 0.42);
    vec3 lightDir = normalize(vec3(-0.7, 0.5, 0.8));
    float diffuse = max(0.15, dot(n, lightDir));
    float fresnel = pow(1.0 - max(0.0, n.z), 3.5);
    vec3 atmosphere = vec3(0.22, 0.72, 1.0) * fresnel * 0.55;
    vec3 col = tex * (0.18 + diffuse * 1.05);
    col += atmosphere;
    col += vec3(0.9, 0.98, 1.0) * pow(max(0.0, dot(reflect(-lightDir, n), vec3(0.0, 0.0, 1.0))), 18.0) * 0.12;
    col *= disc;
    col += color * ringBand(r, coreRadius + 0.002, 0.004) * 0.22;
    return col;
  }

  vec3 molecularFallback(vec2 q, vec3 color, float t, float disc){
    vec2 p = rot(0.35) * q;
    float ribbon0 = 1.0 - smoothstep(0.008, 0.026, abs((p.y + 0.02) - sin((p.x * 3.2 + 0.3) * 4.6 + t * 0.35) * 0.075));
    float ribbon1 = 1.0 - smoothstep(0.008, 0.026, abs(((rot(-0.8) * q).y + 0.04) - sin(((rot(-0.8) * q).x * 3.2 - 0.2) * 4.6 + 1.6 + t * 0.28) * 0.075));
    float grid = smoothstep(0.77, 1.0, fbm(q * 10.0 + t * 0.05));
    vec3 col = vec3(0.025, 0.018, 0.010) * disc;
    col += color * (ribbon0 * 0.42 + ribbon1 * 0.34 + grid * 0.05) * disc;
    col += vec3(0.28, 0.62, 0.72) * ribbon0 * disc * 0.08;
    return col * disc;
  }

  vec3 molecularCore0(vec2 q, vec3 color, float t){
    float coreRadius = 0.245;
    float r = length(q);
    float disc = 1.0 - smoothstep(coreRadius, coreRadius + 0.010, r);
    if(disc <= 0.0) return vec3(0.0);
    vec2 uv = q / (coreRadius * 1.65) + 0.5;
    vec3 tex = molecularFallback(q, color, t, disc);
    if(uPortalLoaded.x > 0.5 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) tex = texture2D(uPortalTex0, uv).rgb;
    float innerShade = 1.0 - smoothstep(0.0, coreRadius, r);
    vec3 base = vec3(0.018, 0.013, 0.008) * disc;
    vec3 col = base + tex * (0.82 + innerShade * 0.18);
    col += color * ringBand(r, coreRadius + 0.002, 0.004) * 0.20;
    col += vec3(1.0, 0.96, 0.82) * pow(max(0.0, 1.0 - r / coreRadius), 5.0) * 0.06;
    return col * disc;
  }

  vec3 molecularCore1(vec2 q, vec3 color, float t){
    float coreRadius = 0.245;
    float r = length(q);
    float disc = 1.0 - smoothstep(coreRadius, coreRadius + 0.010, r);
    if(disc <= 0.0) return vec3(0.0);
    vec2 uv = q / (coreRadius * 1.65) + 0.5;
    vec3 tex = molecularFallback(q, color, t, disc);
    if(uPortalLoaded.y > 0.5 && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) tex = texture2D(uPortalTex1, uv).rgb;
    float innerShade = 1.0 - smoothstep(0.0, coreRadius, r);
    vec3 base = vec3(0.018, 0.013, 0.008) * disc;
    vec3 col = base + tex * (0.82 + innerShade * 0.18);
    col += color * ringBand(r, coreRadius + 0.002, 0.004) * 0.20;
    col += vec3(1.0, 0.96, 0.82) * pow(max(0.0, 1.0 - r / coreRadius), 5.0) * 0.06;
    return col * disc;
  }

  vec3 proceduralCore(vec2 q, vec3 color, float t){
    float coreRadius = 0.245;
    float r = length(q);
    float disc = 1.0 - smoothstep(coreRadius, coreRadius + 0.010, r);
    float field = fbm(rot(t * 0.025) * q * 8.0 + vec2(t * 0.018, -t * 0.011));
    float filaments = pow(abs(sin(atan(q.y, q.x) * 7.0 + field * 5.0)), 10.0);
    vec3 col = vec3(0.008, 0.010, 0.025) * disc;
    col += color * (field * 0.20 + filaments * 0.12) * disc;
    col += color * ringBand(r, coreRadius + 0.002, 0.004) * 0.20;
    return col * disc;
  }

  vec3 renderSlotCore(vec2 q, vec3 color, float t, float slotId){
    if(slotId < 0.5){
      if(uPortalMaterials.x < 0.5) return planetaryCore0(q, color, t);
      if(uPortalMaterials.x < 1.5) return molecularCore0(q, color, t);
      return proceduralCore(q, color, t);
    }
    if(uPortalMaterials.y < 0.5) return planetaryCore1(q, color, t);
    if(uPortalMaterials.y < 1.5) return molecularCore1(q, color, t);
    return proceduralCore(q, color, t);
  }

  vec3 portal(vec2 p, vec2 center, float radius, vec3 color, vec4 signature, float id, float hover, float t){
    float active = 1.0 - smoothstep(0.08, 0.12, abs(uActive - id));
    float flight = uTransition * active;
    vec2 c = mix(center, vec2(0.0, 0.02), flight);
    float rad = mix(radius, 1.06, flight);
    vec2 q = p - c;
    float dist = length(q);
    float ang = atan(q.y, q.x);
    float pulse = 0.5 + 0.5 * sin(t * signature.x + signature.y * 2.7);
    float energy = 1.0 + (hover * 0.30 + pulse * 0.035 + flight * 1.25) * signature.z;
    vec3 col = vec3(0.0);

    float innerFade = 1.0 - smoothstep(0.0, rad * 0.90, dist);
    float membraneNoise = fbm(q * 9.0 + vec2(t * 0.025, -t * 0.018));
    float membrane = innerFade * (0.13 + 0.16 * membraneNoise);
    col += color * membrane * 0.45 * energy;
    col += vec3(0.8,0.95,1.0) * innerFade * 0.015;

    vec3 core = renderSlotCore(q / max(rad,0.001) * 0.34, color, t, id);
    col += core * (1.0 + hover * 0.2) * (1.0 - flight * 0.15);

    float varW = 0.013 + 0.007 * sin(ang * 7.0 + t * 1.7 + signature.y) + 0.004 * sin(ang * 17.0 - t * 0.72);
    float main = ringBand(dist, rad, max(0.007, varW));
    float outer = ringBand(dist, rad * 1.055, 0.0055);
    float inner = ringBand(dist, rad * 0.925, 0.0045);
    float microA = ringBand(dist, rad * 0.780, 0.0022);
    float microB = ringBand(dist, rad * 1.115, 0.0020);
    float glassOuter = ringBand(dist, rad * 1.018, 0.019);
    float glassInner = ringBand(dist, rad * 0.970, 0.014);
    float bevel = exp(-abs(dist - rad) * 46.0);

    float circuit = step(0.72, fract((ang / TAU + 0.5) * 96.0 + sin(dist * 70.0) * 0.02));
    circuit *= smoothstep(rad * 0.86, rad * 0.96, dist) * (1.0 - smoothstep(rad * 0.99, rad * 1.08, dist));
    float radialCuts = pow(abs(sin(ang * 152.0 + t * 0.18)), 28.0) * smoothstep(rad * 0.72, rad * 1.08, dist);
    float anis = pow(0.5 + 0.5 * sin(ang * 24.0 + dist * 82.0 - t * 1.2), 8.0);
    float glint = pow(max(0.0, sin(ang * 2.0 - 0.55 + id * 1.7)), 18.0) * bevel;
    float fiber = pow(max(0.0, sin(ang * 64.0 + t * 0.34 + signature.y * 3.1)), 10.0) * glassOuter;
    float scratches = step(0.965, fbm(vec2(ang * 21.0, dist * 84.0) + vec2(t * 0.018, id * 9.0))) * glassOuter;

    col += color * main * (0.92 + anis * 0.38) * energy;
    col += color * (outer * 0.42 + inner * 0.50 + microA * 0.33 + microB * 0.24) * energy;
    col += color * (glassOuter * 0.16 + glassInner * 0.10) * (0.9 + hover * 0.18);
    col += vec3(0.85,0.96,1.0) * glint * (0.26 + hover * 0.20);
    col += vec3(1.0) * fiber * 0.020;
    col += vec3(0.95,1.0,1.0) * scratches * 0.030;
    col += vec3(0.9,1.0,1.0) * main * 0.13;
    col += color * (circuit * 0.12 + radialCuts * 0.15) * energy;

    vec2 eq = rot(-0.42 + id * 0.22 + sin(t * 0.18 + id) * 0.025) * q;
    float saturn = ellipseBand(eq, rad * 1.30, rad * 0.335, 0.010);
    float saturn2 = ellipseBand(eq, rad * 1.25, rad * 0.310, 0.0038);
    float occlusion = smoothstep(-0.02, 0.08, eq.y);
    float saturnMix = mix(0.42, 1.0, occlusion);
    col += color * saturn * saturnMix * (0.52 + hover * 0.18 + flight * 0.52);
    col += vec3(1.0) * saturn2 * saturnMix * 0.08;

    float chromaR = ringBand(dist, rad + 0.010, 0.003);
    float chromaB = ringBand(dist, rad - 0.010, 0.003);
    col += vec3(0.55,0.06,0.02) * chromaR * 0.11;
    col += vec3(0.05,0.18,0.60) * chromaB * 0.13;

    float rays = 0.0;
    rays += pow(max(0.0, sin(ang * 10.0 + t * 0.21)), 18.0);
    rays += pow(max(0.0, sin(ang * 17.0 - t * 0.18)), 28.0) * 0.55;
    float rayMask = smoothstep(rad * 0.95, rad * 1.08, dist) * (1.0 - smoothstep(rad * 1.05, rad * 2.0, dist));
    col += color * rays * rayMask * 0.18 * energy * (1.0 - hover);

    for(int i=0;i<12;i++){
      float fi = float(i);
      float rr = rad * (1.08 + 0.045 * sin(fi * 1.73 + signature.y));
      float aa = t * (signature.w + 0.025 * fi) + fi * TAU / 12.0 + signature.y * 0.6;
      vec2 pp = c + vec2(cos(aa), sin(aa)) * rr;
      vec2 tangent = vec2(-sin(aa), cos(aa));
      vec2 pq = p - pp;
      float dotT = dot(pq, tangent);
      float dotN = length(pq - tangent * clamp(dotT, -0.036, 0.0));
      float spark = 1.0 - smoothstep(0.0, 0.012, length(pq));
      float trail = (1.0 - smoothstep(0.0, 0.012, dotN)) * smoothstep(-0.040, -0.002, dotT) * (1.0 - smoothstep(0.0, 0.018, abs(dot(pq, normalize(pp-c)))));
      col += color * (spark * 0.9 + trail * 0.28) * (0.8 + hover * 0.35);
      col += vec3(1.0) * spark * 0.12;
    }

    float horizon = exp(-abs(dist - rad) * 17.0) * 0.045;
    col += color * horizon * energy;
    col *= mix(1.0, 0.16, uTransition * (1.0 - active));
    return col;
  }

  void main(){
    vec2 uv = gl_FragCoord.xy / uResolution.xy;

    vec2 lensCentered = uv - 0.5;
    float lensR2 = dot(lensCentered, lensCentered);
    uv = 0.5 + lensCentered * (1.0 + 0.065 * lensR2);

    vec2 p = uv * 2.0 - 1.0;
    p.x *= uResolution.x / uResolution.y;

    float breatheAmp = mix(1.0, 0.5, uMobile);
    vec2 breatheDrift = vec2(
      sin(uTime * 0.05) * 0.014,
      cos(uTime * 0.037) * 0.010
    ) * breatheAmp;
    float breatheZoom = 1.0 + sin(uTime * 0.028) * 0.006 * breatheAmp;
    float introZoom = mix(1.55, 1.0, uIntro);
    p = p * breatheZoom * introZoom + breatheDrift;

    float aspect = uResolution.x / uResolution.y;
    float layout = smoothstep(1.15, 1.55, aspect);
    vec2 c0 = mix(vec2(0.0, 0.42), vec2(-0.54, 0.035), layout);
    vec2 c1 = mix(vec2(0.0, -0.32), vec2(0.54, 0.035), layout);
    float rad = mix(0.24, 0.345, layout);

    vec3 col = background(p + uParallax * 0.012, uTime, c0, c1, rad, rad);
    col += portal(p + uParallax * 0.035, c0, rad, uPortalPrimary0, uPortalSignature0, 0.0, uHover.x, uTime);
    col += portal(p + uParallax * 0.035, c1, rad, uPortalPrimary1, uPortalSignature1, 1.0, uHover.y, uTime);

    vec3 hoverGlowColor = uPortalPrimary0 * uHover.x + uPortalPrimary1 * uHover.y;
    col += hoverGlowColor * (uHover.x + uHover.y) * 0.06;
    col *= uIntro;

    if (uSkipFinish < 0.5) {
      vec2 centered = p * vec2(1.0 / max(uResolution.x / uResolution.y, 1.0), 1.0);
      float vignette = 1.0 - smoothstep(0.34, 1.32, length(centered * vec2(1.1, 1.0)));
      col *= 0.55 + 0.62 * vignette;
      col += vec3(0.014, 0.0, 0.028) * (1.0 - vignette);
      col = col / (1.0 + col * 0.82);
      col = pow(col, vec3(0.92));
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(-0.014, 0.010, 0.022);
      vec3 highlightTint = vec3(0.026, 0.010, -0.016);
      col += shadowTint * (1.0 - smoothstep(0.0, 0.55, luma));
      col += highlightTint * smoothstep(0.30, 1.0, luma);
      col = clamp(col, 0.0, 1.0);
      float grain = (hash21(uv * vec2(1920.0, 1080.0) + fract(uTime) * 97.0) - 0.5) * 0.028;
      col += grain;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const postVertexSource = `
  attribute vec2 aPosition;
  varying vec2 vUv;
  void main(){
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

export const brightPassSource = `
  precision highp float;
  uniform sampler2D uScene;
  uniform float uThreshold;
  varying vec2 vUv;
  void main(){
    vec3 color = texture2D(uScene, vUv).rgb;
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float contribution = smoothstep(uThreshold, uThreshold + 0.35, luminance);
    gl_FragColor = vec4(color * contribution, 1.0);
  }
`;

export const blurSource = `
  precision highp float;
  uniform sampler2D uInput;
  uniform vec2 uDirection;
  varying vec2 vUv;
  void main(){
    vec4 sum = vec4(0.0);
    sum += texture2D(uInput, vUv - uDirection * 3.2307) * 0.070;
    sum += texture2D(uInput, vUv - uDirection * 1.3846) * 0.318;
    sum += texture2D(uInput, vUv)                        * 0.227;
    sum += texture2D(uInput, vUv + uDirection * 1.3846) * 0.318;
    sum += texture2D(uInput, vUv + uDirection * 3.2307) * 0.070;
    gl_FragColor = sum;
  }
`;

export const compositeSource = `
  precision highp float;
  uniform sampler2D uScene;
  uniform sampler2D uBloom;
  uniform float uBloomStrength;
  uniform float uTime;
  uniform vec2 uActiveCenterUv;
  uniform float uTransitionAmt;
  varying vec2 vUv;

  float hash21(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main(){
    vec2 uv = vUv;
    vec2 centered = uv - 0.5;
    float edgeAmount = dot(centered, centered);
    vec2 caOffset = centered * edgeAmount * 0.006;
    float r = texture2D(uScene, uv - caOffset).r;
    float g = texture2D(uScene, uv).g;
    float b = texture2D(uScene, uv + caOffset).b;
    vec3 col = vec3(r, g, b);

    if(uTransitionAmt > 0.001){
      vec3 streakSum = vec3(0.0);
      const int SAMPLES = 6;
      for(int i = 0; i < SAMPLES; i++){
        float fi = float(i) / float(SAMPLES - 1);
        vec2 sampleUv = mix(uv, uActiveCenterUv, fi * uTransitionAmt * 0.55);
        streakSum += texture2D(uScene, clamp(sampleUv, 0.0, 1.0)).rgb;
      }
      vec3 streaked = streakSum / float(SAMPLES);
      col = mix(col, streaked, smoothstep(0.0, 1.0, uTransitionAmt));
      col *= 1.0 + uTransitionAmt * 0.55;
    }

    col += texture2D(uBloom, uv).rgb * uBloomStrength;

    float vignette = 1.0 - smoothstep(0.34, 1.32, length(centered * vec2(1.1, 1.0)));
    col *= 0.55 + 0.62 * vignette;
    col += vec3(0.014, 0.0, 0.028) * (1.0 - vignette);

    col = col / (1.0 + col * 0.82);
    col = pow(col, vec3(0.92));

    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 shadowTint = vec3(-0.014, 0.010, 0.022);
    vec3 highlightTint = vec3(0.026, 0.010, -0.016);
    col += shadowTint * (1.0 - smoothstep(0.0, 0.55, luma));
    col += highlightTint * smoothstep(0.30, 1.0, luma);
    col = clamp(col, 0.0, 1.0);
    float grain = (hash21(uv * vec2(1920.0, 1080.0) + fract(uTime) * 97.0) - 0.5) * 0.028;
    col += grain;

    gl_FragColor = vec4(col, 1.0);
  }
`;
