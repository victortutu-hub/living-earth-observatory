import { createSurfaceMaterialLodConfig } from './surface-material-lod.js';
import { ATMOSPHERE, ATMOSPHERE_GLSL } from './atmosphere-physics.js';

// Relief shading has one source only: ETOPO normals lit by the real Sun
// (Lambert through the material's lighting). The perturbation is limited to
// land (the sea surface is flat; the sea floor stays only in the bathymetry
// colour ramp) and fades only where the Sun is below the local horizon, so
// long shadows at low Sun survive up to the terminator.
export const RELIEF_TERMINATOR_EDGES = Object.freeze([-0.05, 0.05]);
export const RELIEF_STRENGTH = Object.freeze({ phong: 0.72, pbr: 0.4 });
// Ocean colour = Blue Marble NG albedo only. The former bathymetric ramp
// (0.28) survives only as a visual-lock A/B option (bathymetryMix).
export const BATHYMETRY_MIX = 0;

// Encoding of assets/etopo2022-bedrock-relief-2160x1080.png, reconstructed
// (LOT 4b ETAPA 0) from 2.3 M (elevation, gray) pairs of the ETOPO 2022 60"
// grid at the same stride 10 (median error 4e-6 gray). The PNG holds POINT
// samples every 1/6 deg, so peaks are missed: the highest sample is 6,734 m
// (Karakoram); the texel at Everest reads ~5,029 m, not 8,849 m.
//   land  (z > 0): gray = 0.42 + 0.5046 * (z / 6734 m)^0.48   (sqrt-like)
//   ocean (z < 0): gray = 0.42 - 0.2323 * (|z| / 10511 m)^0.72
// The normal map is "central differences; strength=38" of that gray, i.e.
// n.xy = -76 * (central difference per texel). The geometric exaggeration is
// therefore NOT a constant: it grows strongly towards low elevations.
export const RELIEF_ENCODING = Object.freeze({
    seaLevelGray: 0.42,
    normalGainPerTexel: 76,
    landGrayRange: 0.5046,
    landMaxM: 6734,
    landExponent: 0.48,
    oceanGrayRange: 0.2323,
    oceanMaxDepthM: 10511,
    oceanExponent: 0.72,
    metersPerSceneUnit: ATMOSPHERE.metersPerSceneUnit,
});

/** Relief gray for a land elevation in metres (z > 0), per the reconstructed encoding. */
export function reliefGrayForLandElevation(elevationM, encoding = RELIEF_ENCODING) {
    const z = Math.max(0, elevationM);
    return encoding.seaLevelGray + encoding.landGrayRange * (z / encoding.landMaxM) ** encoding.landExponent;
}

/** Geometric vertical exaggeration at a land elevation (default: the highest 1/6 deg sample). */
export function verticalExaggerationAt(displacementScale, elevationM = RELIEF_ENCODING.landMaxM, encoding = RELIEF_ENCODING) {
    if (!(elevationM > 0)) return NaN;
    const displacedM = (reliefGrayForLandElevation(elevationM, encoding) - encoding.seaLevelGray) * displacementScale * encoding.metersPerSceneUnit;
    return displacedM / elevationM;
}

/** displacementScale giving exaggeration N at a land elevation (default: the highest sample). */
export function displacementScaleForExaggeration(exaggeration, elevationM = RELIEF_ENCODING.landMaxM, encoding = RELIEF_ENCODING) {
    const grayRise = reliefGrayForLandElevation(elevationM, encoding) - encoding.seaLevelGray;
    return exaggeration * elevationM / (grayRise * encoding.metersPerSceneUnit);
}

// Displacement in scene units per relief gray unit, unchanged since LOT 4.
// LOT 4 labelled it "x10 at Everest" from a wrong anchor (gray 0.8586 taken
// as 8,849 m); with the reconstructed encoding it is ~x15 at the highest
// sample and far more at low elevations (see reliefExaggerationLabel).
export const EARTH_RELIEF_SCALE = 0.0633356100942748;

/** Honest UI description of the current (legacy, non-linear) geometric relief. */
export function reliefExaggerationLabel(displacementScale) {
    if (!(displacementScale > 0)) {
        return 'Relief: no geometric displacement (relief shading from ETOPO 2022 normals only)';
    }
    const at = (m) => Math.round(verticalExaggerationAt(displacementScale, m));
    return `Relief: non-linear vertical exaggeration (≈×${at(RELIEF_ENCODING.landMaxM)} at the highest 1/6° sample, 6,734 m; `
        + `≈×${at(1000)} at 1,000 m; ≈×${at(100)} at 100 m; much stronger at low elevations — legacy sqrt-like encoding `
        + 'of ETOPO 2022 60″ bedrock, point-sampled 1/6°; ocean surface flat)';
}

export const SURFACE_DEBUG_VIEWS = Object.freeze({ none: 0, tilt: 1, tiltClipped: 2, landWeight: 3 });

/** Visual-lock A/B options -> shader options. Production ({}) compiles none of them in. */
function lockShaderOptions(overrides = {}) {
    return Object.freeze({
        coastNormals: overrides.coastNormals === 'clip',
        surfaceDebug: SURFACE_DEBUG_VIEWS[overrides.surfaceDebug] || 0,
        bathymetryMix: Number(overrides.bathymetryMix) > 0 ? Number(overrides.bathymetryMix) : 0,
    });
}

// Visual-lock only (not in production): coast correction A/B and debug views,
// compiled in only when requested. The correction removes from the normal-map
// slope the part that comes from the relief below sea level: slope' = slope - k * (grad(max(h, sea)) - grad(h)),
// from 4 extra relief samples. Debug views (grayscale, so the tone mapper
// keeps them monotonic): tangent tilt (1 - n.z) of the raw normal map (1) or
// of the sea-level-clipped relief (2), and the land weight w (3).
const coastNormalBody = ({ coastNormals }) => `
            float dbgTiltRawTw = 0.0;
            float dbgTiltClipTw = 0.0;
            #ifdef USE_NORMALMAP_TANGENTSPACE
            {
                vec2 reliefTexelTw = 1.0 / vec2(textureSize(uReliefMapTw, 0));
                float hLTw = texture2D(uReliefMapTw, vMapUv - vec2(reliefTexelTw.x, 0.0)).r;
                float hRTw = texture2D(uReliefMapTw, vMapUv + vec2(reliefTexelTw.x, 0.0)).r;
                float hDTw = texture2D(uReliefMapTw, vMapUv - vec2(0.0, reliefTexelTw.y)).r;
                float hUTw = texture2D(uReliefMapTw, vMapUv + vec2(0.0, reliefTexelTw.y)).r;
                vec2 gradRawTw = 0.5 * vec2(hRTw - hLTw, hUTw - hDTw);
                vec2 gradClipTw = 0.5 * vec2(max(hRTw, uSeaLevelTw) - max(hLTw, uSeaLevelTw), max(hUTw, uSeaLevelTw) - max(hDTw, uSeaLevelTw));
                vec3 mapNTw = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
                vec2 slopeTw = mapNTw.xy / max(mapNTw.z, 1e-3);
                vec2 slopeClipTw = slopeTw - ${RELIEF_ENCODING.normalGainPerTexel.toFixed(1)} * (gradClipTw - gradRawTw);
                dbgTiltRawTw = 1.0 - inversesqrt(1.0 + dot(slopeTw, slopeTw));
                dbgTiltClipTw = 1.0 - inversesqrt(1.0 + dot(slopeClipTw, slopeClipTw));
                ${coastNormals ? `vec3 coastNTw = normalize(vec3(slopeClipTw, 1.0));
                coastNTw.xy *= normalScale;
                normal = normalize(tbn * coastNTw);` : ''}
            }
            #endif`;

function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/** JS mirror of the shader weight applied to the relief normal perturbation. */
export function reliefPerturbationWeight({ strength, landWeight, sunDotGeometric }) {
    return strength * landWeight * smoothstep(RELIEF_TERMINATOR_EDGES[0], RELIEF_TERMINATOR_EDGES[1], sunDotGeometric);
}

const reliefNormalBody = (lock) => `
            ${lock.coastNormals || lock.surfaceDebug ? coastNormalBody(lock) : ''}
            // n_geom . sunDir uses the geometric normal (vWorldNormalTw).
            float reliefSunTw = smoothstep(${RELIEF_TERMINATOR_EDGES[0].toFixed(2)}, ${RELIEF_TERMINATOR_EDGES[1].toFixed(2)},
                dot(normalize(vWorldNormalTw), normalize(uSunDirTw)));
            {
                float reliefWeightTw = uReliefStrengthTw * surfaceLandWeightTw * reliefSunTw;
                normal = normalize(nonPerturbedNormal + (normal - nonPerturbedNormal) * reliefWeightTw);
            }`;

// Aerial perspective (single scattering, analytic Chapman optical depth), in
// linear radiance before tone mapping (OutputPass): ground radiance is
// attenuated by the view transmittance and the in-scattered sunlight is added.
// uSunIrradianceTw is the scene sun light (the irradiance that lights the
// ground), so haze and ground share one physical exposure.
const DEBUG_VIEW_VALUE = ['', 'dbgTiltRawTw', 'dbgTiltClipTw', 'surfaceLandWeightTw'];
const aerialPerspectiveBody = ({ surfaceDebug }) => `
            ${surfaceDebug ? `outgoingLight = vec3(${DEBUG_VIEW_VALUE[surfaceDebug]}); // visual-lock debug view
            if (false) {` : 'if (uAerialPerspectiveTw > 0.5) {'}
                vec3 apTransmittanceTw;
                vec3 apInscatterTw = atmoAerialInscatter(vWorldPosTw, cameraPosition, normalize(uSunDirTw),
                    uAtmosphereHazeTw, uSunIrradianceTw, apTransmittanceTw);
                outgoingLight = outgoingLight * apTransmittanceTw + apInscatterTw * uAtmosphereAlphaTw;
            }
            #include <opaque_fragment>`;

// The sea surface is flat in geometry too: displacement is clamped at sea
// level (the ETOPO bedrock map would otherwise sink the ocean surface to the
// exaggerated sea floor, pulling the limb silhouette inside the atmosphere's
// R_E sphere and leaving a dark notch between disc and limb glow).
function injectFlatSeaDisplacement(shader, seaLevel) {
    shader.vertexShader = shader.vertexShader.replace(
        '#include <displacementmap_vertex>',
        `#ifdef USE_DISPLACEMENTMAP
            transformed += normalize( objectNormal ) * ( max( texture2D( displacementMap, vDisplacementMapUv ).x, ${Number(seaLevel).toFixed(4)} ) * displacementScale + displacementBias );
        #endif`
    );
}

export const AERIAL_PERSPECTIVE_UNIFORMS = Object.freeze([
    'uAerialPerspectiveTw', 'uSunIrradianceTw', 'uAtmosphereHazeTw', 'uAtmosphereAlphaTw',
]);

// Shared by Phong and PBR: relief strength, aerial perspective uniforms,
// world-position varying and the GLSL physics library.
function injectReliefAndAerialPerspective(shader, THREE, { reliefStrength, seaLevel, lock }) {
    injectFlatSeaDisplacement(shader, seaLevel);
    shader.uniforms.uReliefStrengthTw = { value: reliefStrength };
    shader.uniforms.uAerialPerspectiveTw = { value: 1.0 };
    shader.uniforms.uSunIrradianceTw = { value: new THREE.Vector3(0, 0, 0) }; // synced from the sun light each frame
    shader.uniforms.uAtmosphereHazeTw = { value: ATMOSPHERE.haze };
    shader.uniforms.uAtmosphereAlphaTw = { value: 1.0 };
    shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPosTw;`
    );
    shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWorldPosTw = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uReliefStrengthTw;
        uniform float uAerialPerspectiveTw;
        uniform vec3 uSunIrradianceTw;
        uniform float uAtmosphereHazeTw;
        uniform float uAtmosphereAlphaTw;
        varying vec3 vWorldPosTw;
        ${ATMOSPHERE_GLSL}`
    );
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', aerialPerspectiveBody(lock));
}

// Injectie de zi/noapte comuna intre MeshPhongMaterial (V1) si
// MeshStandardMaterial (V3.2 PBR) - <common>/<map_fragment> exista identic in
// ambele template-uri de shader Three.js, deci logica de tint zi/noapte se
// aplica neschimbata pe diffuseColor.rgb, indiferent de modelul de iluminare
// folosit mai departe (Blinn-Phong sau Cook-Torrance/GGX).
function injectDayNightTint(shader, THREE) {
    shader.uniforms.uSunDirTw = { value: new THREE.Vector3(1, 0, 0) };
    shader.uniforms.uEarthNightTw = { value: 1.0 };
    shader.uniforms.uEarthTwilightTw = { value: 0.22 };
    shader.uniforms.uSSSEnabledTw = { value: 1.0 };

    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDirTw;
        uniform float uEarthNightTw;
        uniform float uEarthTwilightTw;
        uniform float uSSSEnabledTw;
        varying vec3 vWorldNormalTw;`
    );
    shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldNormalTw;`
    );
    shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWorldNormalTw = normalize(mat3(modelMatrix) * objectNormal);`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // V3.5 - refractie atmosferica (+0.567 grade ≈ +0.0099 in produs
        // scalar la terminator) - Soarele ramane vizibil putin dupa apusul
        // geometric, acelasi motiv ca in atmosphere.js/noctilucent-cloud-system.js.
        float sunDotTw = dot(normalize(vWorldNormalTw), normalize(uSunDirTw)) + 0.0099;
        float dayMaskTw = smoothstep(-0.10, 0.24, sunDotTw);
        float twilightTw = 1.0 - smoothstep(0.00, 0.36, abs(sunDotTw));
        float deepNightTw = 1.0 - smoothstep(-0.58, -0.18, sunDotTw);

        // V3.6 - Subsurface Scattering (SSS) pe gheata/zapada: lumina intra in
        // material si continua sa se imprastie putin dincolo de unghiul de
        // incidenta directa ("wrap lighting", Jensen 2001 simplificat) - de-aici
        // transluciditatea caracteristica ghetarilor, spre deosebire de un
        // Lambertian pur care s-ar opri brusc la terminator. iceMaskTw e o
        // masca aproximata (nu date reale) din textura de baza - alb/gri
        // deschis, saturatie mica = gheata/zapada (calotele polare, Groenlanda,
        // Antarctica, ghetari montani).
        float iceBrightnessTw = dot(diffuseColor.rgb, vec3(0.333));
        float iceMaxTw = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float iceMinTw = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float iceSatTw = iceMaxTw > 0.0001 ? (iceMaxTw - iceMinTw) / iceMaxTw : 0.0;
        float iceMaskTw = smoothstep(0.55, 0.80, iceBrightnessTw) * (1.0 - smoothstep(0.08, 0.24, iceSatTw));
        float wrapTw = 0.3;
        float sssTw = clamp((sunDotTw + wrapTw) / (1.0 + wrapTw), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.4, iceMaskTw * sssTw * 0.5 * uSSSEnabledTw);

        vec3 nightTintTw = vec3(0.026, 0.040, 0.078);
        vec3 duskTintTw = vec3(1.14, 0.76, 0.48);
        diffuseColor.rgb *= mix(mix(vec3(1.0), nightTintTw, uEarthNightTw), vec3(1.0), dayMaskTw);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * duskTintTw, twilightTw * uEarthTwilightTw);
        diffuseColor.rgb *= mix(1.0, 0.72, deepNightTw * uEarthNightTw);

        // A single observed-derived ETOPO sample is shared by bathymetry and
        // 2.4B land gating below. It is intentionally not a new detail map.
        float surfaceReliefTw = texture2D(uReliefMapTw, vMapUv).r;
        float surfaceLandWeightTw = smoothstep(
            uSurfaceMaterialCoastStartTw,
            uSurfaceMaterialCoastEndTw,
            surfaceReliefTw
        );`
    );
}

// Sprint 1.5 - Batimetrie: rampa hipsometrica pe adancime, din aceeasi
// textura ETOPO folosita deja ca displacement/bump (earthRelief), fara sursa
// noua de date. Sub nivelul marii (relief < seaLevel) tenta oceanul spre
// turcoaz la tarm si bleumarin foarte inchis la santuri adanci, in loc de un
// albastru uniform din harta de baza - acelasi tip de semnal ca o harta
// batimetrica reala (GEBCO etc.), derivat din elevatia deja incarcata.
// Ancorat pe <normal_fragment_maps> (nu <map_fragment>, deja ocupat de
// injectDayNightTint / glint-ul oceanic Phong) - ruleaza dupa ambele, pe
// diffuseColor deja calculat.
// GLSL-ul care sampleaza relieful si aplica rampa. `vMapUv` e varying-ul de UV
// pe care Three.js il declara pentru textura `map` (Three modern: NU `vUv`,
// care exista doar cu USE_UV). Ambele materiale au `map`, deci `vMapUv` e
// garantat prezent aici.
// Visual-lock A/B only since LOT 4 (production: BATHYMETRY_MIX = 0, not compiled).
const bathymetryRampBody = (mix) => mix > 0 ? `
        float depthTw = clamp(uSeaLevelTw - surfaceReliefTw, 0.0, uSeaLevelTw) / max(uSeaLevelTw, 0.0001);
        // Tranzitie imblanzita la tarm, evita o linie dura de coasta.
        float underwaterTw = smoothstep(0.0, 0.012, uSeaLevelTw - surfaceReliefTw);
        // Culori mai putin saturate: un indiciu subtil de adancime peste
        // imaginea reala Blue Marble, nu o revopsire a oceanului.
        vec3 shelfColorTw = vec3(0.10, 0.34, 0.42);
        vec3 abyssColorTw = vec3(0.02, 0.05, 0.11);
        vec3 bathyRampTw = mix(shelfColorTw, abyssColorTw, pow(depthTw, 0.6));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, bathyRampTw, ${mix.toFixed(4)}), underwaterTw);` : '';

// Inregistreaza valorile uniformelor SI le declara in sursa GLSL. Uniformele
// GLSL sunt globale - nu pot fi declarate in interiorul blocului main() unde
// se injecteaza corpul, deci le prepend la fragmentShader. IMPORTANT: aceasta
// functie muteaza shader.fragmentShader, deci trebuie apelata ca instructiune
// SEPARATA, inainte de replace-ul care insereaza corpul de relief - daca
// ar fi apelata in interiorul aceleiasi expresii `x = x.replace(a, f())`,
// ordinea de evaluare JS (citeste x, apoi evalueaza argumentele) ar face ca
// replace-ul sa ruleze pe stringul dinainte de prepend, pierzand declaratiile.
// uReliefMapTw feeds the land/water mask (surfaceLandWeightTw).
function declareReliefMaskUniforms(shader, { reliefTextureRef, earthReliefSeaLevel }) {
    shader.uniforms.uReliefMapTw = { value: reliefTextureRef.current };
    shader.uniforms.uSeaLevelTw = { value: earthReliefSeaLevel };
    shader.fragmentShader = `uniform sampler2D uReliefMapTw;\nuniform float uSeaLevelTw;\n${shader.fragmentShader}`;
}

// KTX2 upgrades replace material slots after shaders have been compiled. Keep
// injected samplers aligned with that same active texture reference rather
// than leaving land gating attached to the initial placeholder.
export function syncActiveReliefTexture(materials, reliefTextureRef, texture) {
    if (!reliefTextureRef || !texture) return;
    reliefTextureRef.current = texture;
    for (const material of materials) {
        const uniform = material?.userData?.shader?.uniforms?.uReliefMapTw;
        if (uniform) uniform.value = texture;
    }
}

function injectSurfaceMaterialShared(shader, { THREE, surfaceMaterial, earthReliefSeaLevel }) {
    shader.uniforms.uSurfaceMaterialCameraDistanceTw = { value: Infinity };
    shader.uniforms.uSurfaceMaterialMesoFullDistanceTw = { value: surfaceMaterial.mesoFullDistance };
    shader.uniforms.uSurfaceMaterialMesoFadeDistanceTw = { value: surfaceMaterial.mesoFadeOutDistance };
    shader.uniforms.uSurfaceMaterialMesoEnabledTw = { value: surfaceMaterial.mode === 'off' ? 0 : 1 };
    shader.uniforms.uSurfaceMaterialCoastStartTw = { value: earthReliefSeaLevel + surfaceMaterial.coastStartReliefOffset };
    shader.uniforms.uSurfaceMaterialCoastEndTw = { value: earthReliefSeaLevel + surfaceMaterial.coastEndReliefOffset };
    shader.uniforms.uSurfaceMaterialMesoFrequencyTw = { value: surfaceMaterial.mesoFrequency };
    shader.uniforms.uSurfaceMaterialPbrRoughnessAmplitudeTw = { value: surfaceMaterial.pbrRoughnessAmplitude };
    shader.uniforms.uSurfaceMaterialPbrRoughnessMinTw = { value: surfaceMaterial.pbrRoughnessMin };
    shader.uniforms.uSurfaceMaterialPbrRoughnessMaxTw = { value: surfaceMaterial.pbrRoughnessMax };
    shader.uniforms.uSurfaceMaterialPhongSpecularAmplitudeTw = { value: surfaceMaterial.phongSpecularAmplitude };

    shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSurfaceMaterialDirectionTw;`
    );
    shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSurfaceMaterialDirectionTw = normalize(position);`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform float uSurfaceMaterialCameraDistanceTw;
        uniform float uSurfaceMaterialMesoFullDistanceTw;
        uniform float uSurfaceMaterialMesoFadeDistanceTw;
        uniform float uSurfaceMaterialMesoEnabledTw;
        uniform float uSurfaceMaterialCoastStartTw;
        uniform float uSurfaceMaterialCoastEndTw;
        uniform float uSurfaceMaterialMesoFrequencyTw;
        uniform float uSurfaceMaterialPbrRoughnessAmplitudeTw;
        uniform float uSurfaceMaterialPbrRoughnessMinTw;
        uniform float uSurfaceMaterialPbrRoughnessMaxTw;
        uniform float uSurfaceMaterialPhongSpecularAmplitudeTw;
        varying vec3 vSurfaceMaterialDirectionTw;

        float surfaceMaterialMesoWeightTw() {
            return uSurfaceMaterialMesoEnabledTw * (1.0 - smoothstep(
                uSurfaceMaterialMesoFullDistanceTw,
                uSurfaceMaterialMesoFadeDistanceTw,
                uSurfaceMaterialCameraDistanceTw
            ));
        }
        float surfaceMaterialSignalTw(vec3 direction, float frequency) {
            float a = sin(dot(direction, vec3(1.17, 0.61, 0.83)) * frequency + 0.37);
            float b = sin(dot(direction, vec3(-0.49, 1.31, 0.72)) * frequency - 0.91);
            return clamp(0.5 + a * 0.30 + b * 0.20, 0.0, 1.0);
        }`
    );
}

function surfaceMaterialPbrRoughnessBody() {
    return `
        vec3 surfaceDirectionTw = normalize(vSurfaceMaterialDirectionTw);
        float surfaceMesoTw = surfaceMaterialSignalTw(surfaceDirectionTw, uSurfaceMaterialMesoFrequencyTw) - 0.5;
        roughnessFactor = clamp(
            roughnessFactor + surfaceMesoTw * uSurfaceMaterialPbrRoughnessAmplitudeTw * surfaceLandWeightTw * surfaceMaterialMesoWeightTw(),
            uSurfaceMaterialPbrRoughnessMinTw,
            uSurfaceMaterialPbrRoughnessMaxTw
        );`;
}

function surfaceMaterialPhongSpecularBody() {
    return `
            // Same deterministic meso response and LOD as PBR. The existing
            // specular map provides the water suppression before ocean glints.
            vec3 surfaceDirectionTw = normalize(vSurfaceMaterialDirectionTw);
            float surfaceMesoTw = surfaceMaterialSignalTw(surfaceDirectionTw, uSurfaceMaterialMesoFrequencyTw) - 0.5;
            float surfaceLandFromSpecularTw = 1.0 - smoothstep(0.05, 0.55, specularStrength);
            specularStrength *= 1.0 - surfaceMesoTw * uSurfaceMaterialPhongSpecularAmplitudeTw *
                surfaceLandFromSpecularTw * surfaceMaterialMesoWeightTw();`;
}

export function createEarthMaterial({
    THREE,
    earthMap,
    earthSpecular,
    earthRelief,
    earthReliefNormal,
    earthReliefSeaLevel = 0.42,
    earthReliefScale = EARTH_RELIEF_SCALE,
    reliefTextureRef = { current: earthRelief },
    surfaceMaterial = createSurfaceMaterialLodConfig(),
    // Visual-lock A/B overrides only (surfaceVisualOverridesFromSearch); {} = defaults.
    overrides = {}
}) {
    const material = new THREE.MeshPhongMaterial({
        map: earthMap,
        specularMap: earthSpecular,
        normalMap: earthReliefNormal,
        // Full tangent perturbation here; its strength is uReliefStrengthTw.
        // No bumpMap: three r185 ignores it whenever a normalMap is present.
        normalScale: new THREE.Vector2(1, 1),
        displacementMap: earthRelief,
        displacementScale: earthReliefScale,
        displacementBias: -earthReliefSeaLevel * earthReliefScale,
        shininess: 28,
        specular: new THREE.Color(0x1e4a6e),
        // The black scene fog has no physical meaning on the surface; the
        // aerial perspective below is the atmosphere along the view ray.
        fog: false
    });

    material.userData.reliefSource = 'NOAA NCEI ETOPO 2022 60 arc-second Bedrock elevation, sampled with horizStride=10';
    material.userData.surfaceMaterial = surfaceMaterial;
    const lock = lockShaderOptions(overrides);
    material.onBeforeCompile = shader => {
        injectSurfaceMaterialShared(shader, { THREE, surfaceMaterial, earthReliefSeaLevel });
        injectReliefAndAerialPerspective(shader, THREE, {
            reliefStrength: overrides.reliefStrength ?? RELIEF_STRENGTH.phong,
            seaLevel: earthReliefSeaLevel,
            lock
        });
        shader.uniforms.uSunDirTw = { value: new THREE.Vector3(1, 0, 0) };
        shader.uniforms.uEarthNightTw = { value: 1.0 };
        shader.uniforms.uEarthTwilightTw = { value: 0.22 };
        shader.uniforms.uFresnelEnabledTw = { value: 1.0 };
        shader.uniforms.uSSSEnabledTw = { value: 1.0 };

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            uniform vec3 uSunDirTw;
            uniform float uEarthNightTw;
            uniform float uEarthTwilightTw;
            uniform float uFresnelEnabledTw;
            uniform float uSSSEnabledTw;
            varying vec3 vWorldNormalTw;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vWorldNormalTw;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
            vWorldNormalTw = normalize(mat3(modelMatrix) * objectNormal);`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            // V3.5 - refractie atmosferica, vezi atmosphere.js.
            float sunDotTw = dot(normalize(vWorldNormalTw), normalize(uSunDirTw)) + 0.0099;
            float dayMaskTw = smoothstep(-0.10, 0.24, sunDotTw);
            float twilightTw = 1.0 - smoothstep(0.00, 0.36, abs(sunDotTw));
            float deepNightTw = 1.0 - smoothstep(-0.58, -0.18, sunDotTw);

            // V3.6 - SSS pe gheata/zapada (wrap lighting) - vezi earth-material.js
            // createEarthMaterialPBR pentru explicatia completa.
            float iceBrightnessTw = dot(diffuseColor.rgb, vec3(0.333));
            float iceMaxTw = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
            float iceMinTw = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
            float iceSatTw = iceMaxTw > 0.0001 ? (iceMaxTw - iceMinTw) / iceMaxTw : 0.0;
            float iceMaskTw = smoothstep(0.55, 0.80, iceBrightnessTw) * (1.0 - smoothstep(0.08, 0.24, iceSatTw));
            float wrapTw = 0.3;
            float sssTw = clamp((sunDotTw + wrapTw) / (1.0 + wrapTw), 0.0, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.4, iceMaskTw * sssTw * 0.5 * uSSSEnabledTw);

            vec3 nightTintTw = vec3(0.026, 0.040, 0.078);
            vec3 duskTintTw = vec3(1.14, 0.76, 0.48);
            diffuseColor.rgb *= mix(mix(vec3(1.0), nightTintTw, uEarthNightTw), vec3(1.0), dayMaskTw);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * duskTintTw, twilightTw * uEarthTwilightTw);
            diffuseColor.rgb *= mix(1.0, 0.72, deepNightTw * uEarthNightTw);

            // Shares the active observed-derived ETOPO sample with
            // bathymetry and 2.4B material land gating below.
            float surfaceReliefTw = texture2D(uReliefMapTw, vMapUv).r;
            float surfaceLandWeightTw = smoothstep(
                uSurfaceMaterialCoastStartTw,
                uSurfaceMaterialCoastEndTw,
                surfaceReliefTw
            );`
        );

        // Ocean roughness at the terminator: boosts specular ocean glints near sunrise/sunset.
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <specularmap_fragment>',
            `#include <specularmap_fragment>
            ${surfaceMaterialPhongSpecularBody()}
            {
                float sDot = dot(normalize(vWorldNormalTw), normalize(uSunDirTw));
                float terminatorBoost = exp(-pow(sDot * 3.8, 2.0));
                specularStrength += specularStrength * terminatorBoost * 3.2;
            }
            // V3.1 Fresnel pe oceane (Schlick approximation): reflectivitatea apei
            // creste puternic la unghi razant fata de camera - F0=0.02 la incidenta
            // normala (~2% reflectivitate, apa arata difuz-albastra), aproape 100%
            // la limb (oglinda). oceanMaskTw vine din harta specular existenta
            // (aceeasi care distinge deja ocean de continent pentru shininess).
            // Aplicat doar pe partea zilei - fara Soare direct, nu exista lumina
            // de reflectat (fresnel pe o mare intunecata ramane negru, corect fizic).
            {
                float oceanMaskTw = clamp(specularStrength, 0.0, 1.0);
                float viewCosTw = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
                float fresnelTw = 0.02 + 0.98 * pow(1.0 - viewCosTw, 5.0);
                fresnelTw *= uFresnelEnabledTw;
                // Sheen difuz larg pe tot limb-ul oceanic (culoarea cerului reflectat) -
                // separat de highlight-ul specular Blinn-Phong existent, care ramane
                // concentrat langa directia reala de reflexie a Soarelui.
                vec3 fresnelSkyTintTw = vec3(0.58, 0.70, 0.82);
                diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, fresnelSkyTintTw, 0.5),
                    oceanMaskTw * fresnelTw * dayMaskTw);
                // Amplifica highlight-ul specular existent (Blinn-Phong) la unghi
                // razant - exact "oceanul explodeaza in lumina" descris in roadmap.
                specularStrength += specularStrength * fresnelTw * 3.6 * dayMaskTw;
            }`
        );

        declareReliefMaskUniforms(shader, { reliefTextureRef, earthReliefSeaLevel });
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
            ${reliefNormalBody(lock)}
            ${bathymetryRampBody(lock.bathymetryMix)}`
        );

        material.userData.shader = shader;
    };
    // Lock A/B options change the generated GLSL: keep their programs apart.
    material.customProgramCacheKey = () => `earth-phong:${JSON.stringify(lock)}`;

    return material;
}

// V3.2 - varianta PBR (MeshStandardMaterial), comutabila cu materialul Phong
// de mai sus. roughnessMap/metalnessMap sunt esantionate automat de Three.js
// prin chunk-urile standard <roughnessmap_fragment>/<metalnessmap_fragment> -
// nu mai trebuie shader custom pentru asta, doar reinjectam acelasi tint de
// zi/noapte (identic ca efect vizual cu varianta Phong).
export function createEarthMaterialPBR({
    THREE,
    earthMap,
    earthRoughnessMap,
    earthRelief,
    earthReliefNormal,
    earthReliefSeaLevel = 0.42,
    earthReliefScale = EARTH_RELIEF_SCALE,
    reliefTextureRef = { current: earthRelief },
    surfaceMaterial = createSurfaceMaterialLodConfig(),
    // Visual-lock A/B overrides only (surfaceVisualOverridesFromSearch); {} = defaults.
    overrides = {}
}) {
    const material = new THREE.MeshStandardMaterial({
        map: earthMap,
        roughnessMap: earthRoughnessMap,
        metalnessMap: earthRoughnessMap,
        roughness: 1.0,
        metalness: 1.0,
        normalMap: earthReliefNormal,
        // Full tangent perturbation; strength is uReliefStrengthTw (0.4, lower
        // than Phong's 0.72: under GGX the same normal map reads much rougher,
        // flat basins like the Amazon looked mountainous).
        normalScale: new THREE.Vector2(1, 1),
        // FARA bumpMap aici (spre deosebire de varianta Phong) - bump-ul e o
        // pseudo-normala mai bruta (derivata numeric din inaltime), iar sub
        // Fresnel real (GGX, corect fizic) devine vizibil sparkle/patratele la
        // unghi razant/terminator - normalMap + displacementMap deja dau
        // suficient detaliu de relief fara acest strat suplimentar.
        displacementMap: earthRelief,
        displacementScale: earthReliefScale,
        displacementBias: -earthReliefSeaLevel * earthReliefScale,
        fog: false
    });

    material.userData.reliefSource = 'NOAA NCEI ETOPO 2022 60 arc-second Bedrock elevation, sampled with horizStride=10';
    material.userData.roughnessSource = earthRoughnessMap.userData?.source
        || 'Procedural roughness/metalness approximation (see earth-roughness.js)';
    material.userData.surfaceMaterial = surfaceMaterial;
    const lock = lockShaderOptions(overrides);
    material.onBeforeCompile = shader => {
        injectSurfaceMaterialShared(shader, { THREE, surfaceMaterial, earthReliefSeaLevel });
        injectDayNightTint(shader, THREE);
        injectReliefAndAerialPerspective(shader, THREE, {
            reliefStrength: overrides.reliefStrength ?? RELIEF_STRENGTH.pbr,
            seaLevel: earthReliefSeaLevel,
            lock
        });

        // Same relief rule as Phong (land only, fades only below the local
        // horizon). It replaces the former partial ocean flattening (0.55 by
        // roughness): the sea surface is now flat, so no glint field from
        // sea-floor ridges either.
        declareReliefMaskUniforms(shader, { reliefTextureRef, earthReliefSeaLevel });
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
            ${reliefNormalBody(lock)}
            ${bathymetryRampBody(lock.bathymetryMix)}
            ${surfaceMaterialPbrRoughnessBody()}`
        );

        material.userData.shader = shader;
    };
    material.customProgramCacheKey = () => `earth-pbr:${JSON.stringify(lock)}`;

    return material;
}
