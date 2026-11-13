import { createSurfaceMaterialLodConfig } from './surface-material-lod.js';
import { ATMOSPHERE, ATMOSPHERE_GLSL } from './atmosphere-physics.js';
import { RELIEF_LINEAR_EXAGGERATION, RELIEF_SOURCE, linearDisplacementScale } from './relief-linear.js';

// Relief (LOT 4b-B): ETOPO 2022 60" ice surface in metres, area-averaged to
// 1/6 deg, displaced linearly (x E) with water flat at 0 m, and normals computed
// in the shader from the same heights (no normal map). Relief shading has one
// source only: those normals lit by the real Sun. The perturbation is limited
// to land (MOD44W water fraction) and fades only where the Sun is below the
// local horizon, so long shadows at low Sun survive up to the terminator.
// The ocean colour is the Blue Marble NG albedo only.
export const RELIEF_TERMINATOR_EDGES = Object.freeze([-0.05, 0.05]);
export const RELIEF_STRENGTH = Object.freeze({ phong: 0.72, pbr: 0.4 });
function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/** JS mirror of the shader weight applied to the relief normal perturbation. */
export function reliefPerturbationWeight({ strength, landWeight, sunDotGeometric }) {
    return strength * landWeight * smoothstep(RELIEF_TERMINATOR_EDGES[0], RELIEF_TERMINATOR_EDGES[1], sunDotGeometric);
}

// Linear model: normal from 4 neighbouring surface heights (water clamped at
// 0 m, so the sea floor never tilts the coast), exaggerated by E, along the
// sphere's local east/north (no tangent frame and no normal map involved).
const LINEAR_RELIEF_FRAGMENT_PARS = `
        uniform sampler2D uWaterMaskTw;
        uniform float uWaterMaskReadyTw;
        uniform float uReliefExaggerationTw;
        varying vec3 vReliefEastTw;
        varying vec3 vReliefNorthTw;
        // Water fraction: MOD44W once loaded, z <= 0 until then.
        float reliefWaterTw(vec2 uv, float h) {
            return mix(step(h, 0.0), texture2D(uWaterMaskTw, uv).r, uWaterMaskReadyTw);
        }
        float reliefSurfaceHeightTw(vec2 uv) {
            float h = texture2D(uReliefMapTw, uv).r;
            return mix(h, max(h, 0.0), reliefWaterTw(uv, h));
        }`;
const linearReliefNormalBody = () => `
            {
                vec2 reliefTexelTw = 1.0 / vec2(textureSize(uReliefMapTw, 0));
                float hWTw = reliefSurfaceHeightTw(vMapUv - vec2(reliefTexelTw.x, 0.0));
                float hETw = reliefSurfaceHeightTw(vMapUv + vec2(reliefTexelTw.x, 0.0));
                float hSTw = reliefSurfaceHeightTw(vMapUv - vec2(0.0, reliefTexelTw.y));
                float hNTw = reliefSurfaceHeightTw(vMapUv + vec2(0.0, reliefTexelTw.y));
                vec3 reliefDirTw = normalize(vSurfaceMaterialDirectionTw);
                float reliefCosLatTw = max(sqrt(max(0.0, 1.0 - reliefDirTw.y * reliefDirTw.y)), 0.02);
                vec2 reliefSlopeTw = uReliefExaggerationTw * vec2(
                    (hETw - hWTw) / (4.0 * PI * R_E * reliefCosLatTw * reliefTexelTw.x),
                    (hNTw - hSTw) / (2.0 * PI * R_E * reliefTexelTw.y));
                normal = normalize(normal - reliefSlopeTw.x * normalize(vReliefEastTw) - reliefSlopeTw.y * normalize(vReliefNorthTw));
            }`;

const RELIEF_NORMAL_BODY = `
            ${linearReliefNormalBody()}
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
const AERIAL_PERSPECTIVE_BODY = `
            if (uAerialPerspectiveTw > 0.5) {
                vec3 apTransmittanceTw;
                vec3 apInscatterTw = atmoAerialInscatter(vWorldPosTw, cameraPosition, normalize(uSunDirTw),
                    uAtmosphereHazeTw, uSunIrradianceTw, apTransmittanceTw);
                outgoingLight = outgoingLight * apTransmittanceTw + apInscatterTw * uAtmosphereAlphaTw;
            }
            #include <opaque_fragment>`;

// Displacement = surfaceHeight(z) * E / metresPerSceneUnit with
// surfaceHeight = mix(z, max(z, 0), water): the sea and lakes are flat at 0 m,
// dry land below sea level (Qattara, Death Valley) keeps its negative height.
// The local east/north directions feed the shader normals.
function injectLinearDisplacement(shader, waterMask) {
    shader.uniforms.uWaterMaskTw = waterMask?.uniform ?? { value: null }; // shared: swapped once the R8 mask loads
    shader.uniforms.uWaterMaskReadyTw = waterMask?.ready ?? { value: 0 };
    shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uWaterMaskTw;
        uniform float uWaterMaskReadyTw;
        varying vec3 vReliefEastTw;
        varying vec3 vReliefNorthTw;`
    );
    shader.vertexShader = shader.vertexShader.replace(
        '#include <displacementmap_vertex>',
        `#ifdef USE_DISPLACEMENTMAP
            float reliefHTw = texture2D( displacementMap, vDisplacementMapUv ).x;
            float reliefWaterVTw = mix( step( reliefHTw, 0.0 ), texture2D( uWaterMaskTw, vDisplacementMapUv ).x, uWaterMaskReadyTw );
            float reliefSurfaceVTw = mix( reliefHTw, max( reliefHTw, 0.0 ), reliefWaterVTw );
            transformed += normalize( objectNormal ) * ( reliefSurfaceVTw * displacementScale + displacementBias );
        #endif
        {
            vec3 reliefDirVTw = normalize( position );
            vec3 reliefEastObjTw = vec3( reliefDirVTw.z, 0.0, -reliefDirVTw.x );
            float reliefEastLenTw = length( reliefEastObjTw );
            reliefEastObjTw = reliefEastLenTw > 1e-5 ? reliefEastObjTw / reliefEastLenTw : vec3( 1.0, 0.0, 0.0 );
            vReliefEastTw = normalMatrix * reliefEastObjTw;
            vReliefNorthTw = normalMatrix * cross( reliefDirVTw, reliefEastObjTw );
        }`
    );
}

export const AERIAL_PERSPECTIVE_UNIFORMS = Object.freeze([
    'uAerialPerspectiveTw', 'uSunIrradianceTw', 'uAtmosphereHazeTw', 'uAtmosphereAlphaTw',
]);

// Shared by Phong and PBR: relief strength, aerial perspective uniforms,
// world-position varying and the GLSL physics library.
function injectReliefAndAerialPerspective(shader, THREE, { reliefStrength, waterMask = null, exaggeration = RELIEF_LINEAR_EXAGGERATION }) {
    injectLinearDisplacement(shader, waterMask);
    shader.uniforms.uReliefStrengthTw = { value: reliefStrength };
    shader.uniforms.uReliefExaggerationTw = { value: exaggeration };
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
        ${ATMOSPHERE_GLSL}
        ${LINEAR_RELIEF_FRAGMENT_PARS}`
    );
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', AERIAL_PERSPECTIVE_BODY);
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

        // Land weight = 1 - MOD44W water fraction (z <= 0 until the mask loads).
        float surfaceReliefTw = texture2D(uReliefMapTw, vMapUv).r;
        float surfaceLandWeightTw = 1.0 - reliefWaterTw(vMapUv, surfaceReliefTw);`
    );
}

// Inregistreaza valorile uniformelor SI le declara in sursa GLSL. Uniformele
// GLSL sunt globale - nu pot fi declarate in interiorul blocului main() unde
// se injecteaza corpul, deci le prepend la fragmentShader. IMPORTANT: aceasta
// functie muteaza shader.fragmentShader, deci trebuie apelata ca instructiune
// SEPARATA, inainte de replace-ul care insereaza corpul de relief - daca
// ar fi apelata in interiorul aceleiasi expresii `x = x.replace(a, f())`,
// ordinea de evaluare JS (citeste x, apoi evalueaza argumentele) ar face ca
// replace-ul sa ruleze pe stringul dinainte de prepend, pierzand declaratiile.
// uReliefMapTw: the relief in metres, for the land weight and the normals.
function declareReliefUniforms(shader, { reliefTextureRef }) {
    shader.uniforms.uReliefMapTw = { value: reliefTextureRef.current };
    shader.fragmentShader = `uniform sampler2D uReliefMapTw;\n${shader.fragmentShader}`;
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

function injectSurfaceMaterialShared(shader, { surfaceMaterial }) {
    shader.uniforms.uSurfaceMaterialCameraDistanceTw = { value: Infinity };
    shader.uniforms.uSurfaceMaterialMesoFullDistanceTw = { value: surfaceMaterial.mesoFullDistance };
    shader.uniforms.uSurfaceMaterialMesoFadeDistanceTw = { value: surfaceMaterial.mesoFadeOutDistance };
    shader.uniforms.uSurfaceMaterialMesoEnabledTw = { value: surfaceMaterial.mode === 'off' ? 0 : 1 };
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
    // Scene units per metre (E / metres per scene unit).
    reliefExaggeration = RELIEF_LINEAR_EXAGGERATION,
    earthReliefScale = linearDisplacementScale(reliefExaggeration),
    // { uniform: { value: texture }, ready: { value } } shared by every material (MOD44W R8).
    waterMask = null,
    reliefTextureRef = { current: earthRelief },
    surfaceMaterial = createSurfaceMaterialLodConfig(),
    // Visual-lock A/B overrides only (reliefStrength); {} = defaults.
    overrides = {}
}) {
    const material = new THREE.MeshPhongMaterial({
        map: earthMap,
        specularMap: earthSpecular,
        // No normal map and no bumpMap: the relief normals are computed in the
        // shader from the heights (RELIEF_NORMAL_BODY), scaled by uReliefStrengthTw.
        displacementMap: earthRelief,
        displacementScale: earthReliefScale,
        displacementBias: 0,
        shininess: 28,
        specular: new THREE.Color(0x1e4a6e),
        // The black scene fog has no physical meaning on the surface; the
        // aerial perspective below is the atmosphere along the view ray.
        fog: false
    });

    material.userData.reliefSource = RELIEF_SOURCE;
    material.userData.surfaceMaterial = surfaceMaterial;
    material.onBeforeCompile = shader => {
        injectSurfaceMaterialShared(shader, { surfaceMaterial });
        injectReliefAndAerialPerspective(shader, THREE, {
            reliefStrength: overrides.reliefStrength ?? RELIEF_STRENGTH.phong,
            waterMask,
            exaggeration: reliefExaggeration
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

            // Land weight = 1 - MOD44W water fraction (z <= 0 until the mask loads).
            float surfaceReliefTw = texture2D(uReliefMapTw, vMapUv).r;
            float surfaceLandWeightTw = 1.0 - reliefWaterTw(vMapUv, surfaceReliefTw);`
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

        declareReliefUniforms(shader, { reliefTextureRef });
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
            ${RELIEF_NORMAL_BODY}`
        );

        material.userData.shader = shader;
    };

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
    // Scene units per metre (E / metres per scene unit).
    reliefExaggeration = RELIEF_LINEAR_EXAGGERATION,
    earthReliefScale = linearDisplacementScale(reliefExaggeration),
    // { uniform: { value: texture }, ready: { value } } shared by every material (MOD44W R8).
    waterMask = null,
    reliefTextureRef = { current: earthRelief },
    surfaceMaterial = createSurfaceMaterialLodConfig(),
    // Visual-lock A/B overrides only (reliefStrength); {} = defaults.
    overrides = {}
}) {
    const material = new THREE.MeshStandardMaterial({
        map: earthMap,
        roughnessMap: earthRoughnessMap,
        metalnessMap: earthRoughnessMap,
        roughness: 1.0,
        metalness: 1.0,
        // Relief normals from the heights in the shader; strength 0.4, lower
        // than Phong's 0.72: under GGX the same slopes read much rougher.
        displacementMap: earthRelief,
        displacementScale: earthReliefScale,
        displacementBias: 0,
        fog: false
    });

    material.userData.reliefSource = RELIEF_SOURCE;
    material.userData.roughnessSource = earthRoughnessMap.userData?.source
        || 'Procedural roughness/metalness approximation (see earth-roughness.js)';
    material.userData.surfaceMaterial = surfaceMaterial;
    material.onBeforeCompile = shader => {
        injectSurfaceMaterialShared(shader, { surfaceMaterial });
        injectDayNightTint(shader, THREE);
        injectReliefAndAerialPerspective(shader, THREE, {
            reliefStrength: overrides.reliefStrength ?? RELIEF_STRENGTH.pbr,
            waterMask,
            exaggeration: reliefExaggeration
        });

        // Same relief rule as Phong (land only, fades only below the local
        // horizon). It replaces the former partial ocean flattening (0.55 by
        // roughness): the sea surface is now flat, so no glint field from
        // sea-floor ridges either.
        declareReliefUniforms(shader, { reliefTextureRef });
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
            ${RELIEF_NORMAL_BODY}
            ${surfaceMaterialPbrRoughnessBody()}`
        );

        material.userData.shader = shader;
    };

    return material;
}
