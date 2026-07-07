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
        diffuseColor.rgb *= mix(1.0, 0.72, deepNightTw * uEarthNightTw);`
    );
}

export function createEarthMaterial({
    THREE,
    earthMap,
    earthSpecular,
    earthRelief,
    earthReliefNormal,
    earthReliefSeaLevel = 0.42,
    earthReliefScale = 0.18
}) {
    const material = new THREE.MeshPhongMaterial({
        map: earthMap,
        specularMap: earthSpecular,
        normalMap: earthReliefNormal,
        normalScale: new THREE.Vector2(0.72, 0.72),
        bumpMap: earthRelief,
        bumpScale: 0.02,
        displacementMap: earthRelief,
        displacementScale: earthReliefScale,
        displacementBias: -earthReliefSeaLevel * earthReliefScale,
        shininess: 28,
        specular: new THREE.Color(0x1e4a6e)
    });

    material.userData.reliefSource = 'NOAA NCEI ETOPO 2022 60 arc-second Bedrock elevation, sampled with horizStride=10';
    material.onBeforeCompile = shader => {
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
            diffuseColor.rgb *= mix(1.0, 0.72, deepNightTw * uEarthNightTw);`
        );

        // Ocean roughness at the terminator: boosts specular ocean glints near sunrise/sunset.
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <specularmap_fragment>',
            `#include <specularmap_fragment>
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
    earthReliefNormal,
    earthReliefSeaLevel = 0.42,
    earthReliefScale = 0.18
}) {
    const material = new THREE.MeshStandardMaterial({
        map: earthMap,
        roughnessMap: earthRoughnessMap,
        metalnessMap: earthRoughnessMap,
        roughness: 1.0,
        metalness: 1.0,
        normalMap: earthReliefNormal,
        // Mai mic decat la Phong (0.72) - sub PBR (GGX real), acelasi normal
        // map arata mult mai accidentat (zone plate ca bazinul Amazonului
        // capatau aspect de relief muntos) - Phong e mai "iertator" cu
        // detaliul de normal, PBR il amplifica vizual mult mai mult.
        normalScale: new THREE.Vector2(0.4, 0.4),
        // FARA bumpMap aici (spre deosebire de varianta Phong) - bump-ul e o
        // pseudo-normala mai bruta (derivata numeric din inaltime), iar sub
        // Fresnel real (GGX, corect fizic) devine vizibil sparkle/patratele la
        // unghi razant/terminator - normalMap + displacementMap deja dau
        // suficient detaliu de relief fara acest strat suplimentar.
        displacementMap: earthRelief,
        displacementScale: earthReliefScale,
        displacementBias: -earthReliefSeaLevel * earthReliefScale
    });

    material.userData.reliefSource = 'NOAA NCEI ETOPO 2022 60 arc-second Bedrock elevation, sampled with horizStride=10';
    material.userData.roughnessSource = earthRoughnessMap.userData?.source
        || 'Procedural roughness/metalness approximation (see earth-roughness.js)';
    material.onBeforeCompile = shader => {
        injectDayNightTint(shader, THREE);

        // Reducem (nu eliminam complet) normal map-ul pe pixelii de ocean.
        // Sub PBR (GGX real), denivelarile din normal map devin, la roughness
        // scazut, oglinda - fiecare "creasta" din batimetria marina reflecta
        // Soarele separat, dand campul de sclipiri/aliasing observat pe luciul
        // oceanic. Aplatizarea 100% insa elimina complet textura vizuala a
        // apei (arata "de sticla", plat) - plafonam la 0.55 (nu 1.0), ca sa
        // ramana mai mult relief/valuri vizibile, chiar daca sclipirea reapare
        // usor mai pronuntata fata de plafonul anterior de 0.8. nonPerturbedNormal
        // e normala GEOMETRICA (dinainte de normal map), expusa de Three.js in
        // <normal_fragment_begin> - amestecam spre ea acolo unde roughnessFactor
        // (deja calculat din earthRoughnessMap in <roughnessmap_fragment>)
        // arata ocean, pastrand reliful complet pe uscat.
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
            {
                float oceanFlattenPBR = (1.0 - smoothstep(0.22, 0.42, roughnessFactor)) * 0.55;
                normal = normalize(mix(normal, nonPerturbedNormal, oceanFlattenPBR));
            }`
        );

        material.userData.shader = shader;
    };

    return material;
}
