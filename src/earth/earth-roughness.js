// V3.2 - PBR roughness/metalness per tip de suprafata.
//
// Roadmap-ul cere o textura derivata din MODIS Land Cover (MCD12Q1) reclasificat.
// Acele date reale necesita cont NASA Earthdata si procesare GIS offline -
// indisponibile in acest mediu. In loc sa inventam valori arbitrare, clasificam
// aproximativ tipul de suprafata (ocean/gheata/padure/desert/altele) direct din
// culoarea reala a imaginii NASA Blue Marble (eo_base_2020, deja in assets/,
// nefolosita pana acum), plus latitudinea (randul din imaginea echirectangulara)
// pentru a distinge padure tropicala de cea temperata.
//
// ETICHETA CLARA: aceasta e o APROXIMARE PROCEDURALA din euristici de culoare,
// NU o clasificare MODIS reala. Valorile de roughness per categorie sunt insa
// cele din literatura de teledetecție citata in roadmap (Schaaf et al.).

const SURFACE_ROUGHNESS = {
    ocean: 0.22, // usor peste minimul teoretic (0.10) - reduce sclipirile/aliasing-ul specular la unghi razant
    iceSnow: 0.38,
    desert: 0.62,
    forestTropical: 0.85,
    forestTemperate: 0.80,
    other: 0.68 // savana/teren arabil/mixt - greu de separat doar din culoare
};

function rgbToHueSat(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const brightness = max / 255;
    const sat = max === 0 ? 0 : (max - min) / max;
    let hue = 0;
    if (max !== min) {
        const d = max - min;
        if (max === r) hue = 60 * (((g - b) / d + 6) % 6);
        else if (max === g) hue = 60 * ((b - r) / d + 2);
        else hue = 60 * ((r - g) / d + 4);
    }
    return { hue, sat, brightness };
}

function classifySurface(r, g, b, latAbsNorm) {
    const { hue, sat, brightness } = rgbToHueSat(r, g, b);

    // Ocean: albastru dominant, nu prea intunecat (evita umbre/artefacte).
    if (b > r + 12 && b > g + 4 && brightness > 0.08) {
        return SURFACE_ROUGHNESS.ocean;
    }
    // Gheata/zapada: foarte luminos, saturatie mica (aproape alb).
    if (brightness > 0.72 && sat < 0.18) {
        return SURFACE_ROUGHNESS.iceSnow;
    }
    // Vegetatie: nuanta verde. Tropical vs temperat dupa latitudine
    // (< ~30 grade => centura tropicala/subtropicala reala).
    if (hue > 70 && hue < 165 && sat > 0.12 && brightness < 0.7) {
        return latAbsNorm < 0.33 ? SURFACE_ROUGHNESS.forestTropical : SURFACE_ROUGHNESS.forestTemperate;
    }
    // Desert: nuanta calda (portocaliu-maro), saturatie mica-medie.
    if (hue >= 18 && hue <= 55 && sat < 0.55 && brightness > 0.32) {
        return SURFACE_ROUGHNESS.desert;
    }
    return SURFACE_ROUGHNESS.other;
}

function loadImageElement(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load ${url}`));
        img.src = url;
    });
}

/**
 * Construieste textura de roughness/metalness (G=roughness, B=metalness,
 * conventia standard Three.js roughnessMap/metalnessMap) din imaginea
 * NASA Blue Marble. Metalness ramane 0 peste tot - toate suprafetele
 * naturale sunt dielectrice; fara un mod fiabil de a detecta zone urbane
 * separat, nu inventam o valoare de metal.
 */
export async function createEarthRoughnessTexture({
    THREE,
    colorUrl = 'assets/eo_base_2020_clean_3600x1800.png',
    width = 2048,
    height = 1024
}) {
    const image = await loadImageElement(colorUrl);

    // Clasificam la 2x rezolutia finala, apoi reducem cu smoothing - fara asta,
    // pixeli izolati clasificati gresit (o umbra, un lac mic in mijlocul unui
    // desert) devin puncte de roughness foarte scazut (aproape oglinda) chipiar
    // langa teren aspru, iar sub PBR asta produce sclipiri specular in forma de
    // patrat care apar/dispar la cea mai mica schimbare de unghi camera/Soare -
    // exact aliasing-ul specular clasic la harti roughness cu tranzitii brute.
    // Reducerea cu interpolare are efect de box-blur, elimina outlierii de un
    // singur pixel si inmoaie granitele dintre categorii (oricum graduale in
    // realitate, nu taiate brusc).
    //
    // Rezolutia finala 2048x1024 (fata de 1024x512 initial) - la zoom apropiat,
    // un texel de 1024x512 acopera ~39km pe ecuator, suficient de mare cat sa
    // devina vizibil ca "patrat" plat pe teren/coasta, indiferent de blur.
    // Dublarea rezolutiei injumatateste acea acoperire fizica per texel.
    const superSample = 2;
    const blurFinalPx = 6;
    const sampleWidth = width * superSample;
    const sampleHeight = height * superSample;

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = sampleWidth;
    sampleCanvas.height = sampleHeight;
    const sampleCtx = sampleCanvas.getContext('2d');
    sampleCtx.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const { data } = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight);

    const fullResCanvas = document.createElement('canvas');
    fullResCanvas.width = sampleWidth;
    fullResCanvas.height = sampleHeight;
    const fullResCtx = fullResCanvas.getContext('2d');
    const fullResData = fullResCtx.createImageData(sampleWidth, sampleHeight);

    for (let y = 0; y < sampleHeight; y++) {
        const latAbsNorm = Math.abs(y / sampleHeight - 0.5) * 2; // 0 la ecuator, 1 la poli
        for (let x = 0; x < sampleWidth; x++) {
            const i = (y * sampleWidth + x) * 4;
            const roughness = classifySurface(data[i], data[i + 1], data[i + 2], latAbsNorm);
            fullResData.data[i] = 255;
            fullResData.data[i + 1] = Math.round(roughness * 255);
            fullResData.data[i + 2] = 0; // metalness
            fullResData.data[i + 3] = 255;
        }
    }
    fullResCtx.putImageData(fullResData, 0, 0);

    // Blur real (nu doar interpolarea din resize) - in special la coaste, unde
    // clasificarea alterneaza ocean/uscat pixel-cu-pixel pe fasia de tranzitie,
    // resize-ul singur nu era suficient sa elimine campul de sclipiri imprastiate
    // observat acolo. ctx.filter='blur()' foloseste implementarea nativa a
    // browserului (rapid, fara bucla JS pixel-cu-pixel pe 2M+ pixeli).
    const blurredCanvas = document.createElement('canvas');
    blurredCanvas.width = sampleWidth;
    blurredCanvas.height = sampleHeight;
    const blurredCtx = blurredCanvas.getContext('2d');
    blurredCtx.filter = `blur(${blurFinalPx * superSample}px)`;
    blurredCtx.drawImage(fullResCanvas, 0, 0);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = width;
    outCanvas.height = height;
    const outCtx = outCanvas.getContext('2d');
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(blurredCanvas, 0, 0, width, height);

    const texture = new THREE.CanvasTexture(outCanvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.userData = {
        source: 'Procedural approximation from NASA Blue Marble (eo_base_2020) RGB color heuristics + latitude - NOT true MODIS MCD12Q1 classification.'
    };
    return texture;
}
