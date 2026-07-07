const STAR_VERT = `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * mv;
}`;

const STAR_FRAG = `
varying vec3 vColor;
varying float vAlpha;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float core = 1.0 - smoothstep(0.05, 0.22, r);
    float halo = 1.0 - smoothstep(0.18, 0.5, r);
    float alpha = (core * 0.9 + halo * 0.34) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
}`;

const namedCatalog = [
    { name: 'Sirius', ra: 6.7525, dec: -16.716, mag: -1.46, bv: 0.01 },
    { name: 'Canopus', ra: 6.399, dec: -52.696, mag: -0.74, bv: 0.15 },
    { name: 'Rigil Kentaurus', ra: 14.660, dec: -60.835, mag: -0.27, bv: 0.71 },
    { name: 'Arcturus', ra: 14.261, dec: 19.182, mag: -0.04, bv: 1.23 },
    { name: 'Vega', ra: 18.616, dec: 38.784, mag: 0.03, bv: 0.00 },
    { name: 'Capella', ra: 5.282, dec: 45.998, mag: 0.08, bv: 0.80 },
    { name: 'Rigel', ra: 5.242, dec: -8.202, mag: 0.12, bv: -0.03 },
    { name: 'Procyon', ra: 7.655, dec: 5.225, mag: 0.38, bv: 0.42 },
    { name: 'Achernar', ra: 1.628, dec: -57.237, mag: 0.46, bv: -0.16 },
    { name: 'Betelgeuse', ra: 5.919, dec: 7.407, mag: 0.50, bv: 1.50 },
    { name: 'Hadar', ra: 14.064, dec: -60.373, mag: 0.61, bv: -0.23 },
    { name: 'Altair', ra: 19.846, dec: 8.868, mag: 0.77, bv: 0.22 },
    { name: 'Aldebaran', ra: 4.599, dec: 16.509, mag: 0.87, bv: 1.54 },
    { name: 'Spica', ra: 13.420, dec: -11.161, mag: 1.04, bv: -0.24 },
    { name: 'Antares', ra: 16.490, dec: -26.432, mag: 1.06, bv: 1.83 },
    { name: 'Pollux', ra: 7.755, dec: 28.026, mag: 1.14, bv: 1.00 },
    { name: 'Fomalhaut', ra: 22.961, dec: -29.622, mag: 1.16, bv: 0.09 },
    { name: 'Deneb', ra: 20.690, dec: 45.280, mag: 1.25, bv: 0.09 },
    { name: 'Mimosa', ra: 12.795, dec: -59.689, mag: 1.25, bv: -0.24 },
    { name: 'Regulus', ra: 10.139, dec: 11.967, mag: 1.35, bv: -0.11 },
    { name: 'Adhara', ra: 6.977, dec: -28.972, mag: 1.50, bv: -0.21 },
    { name: 'Castor', ra: 7.577, dec: 31.889, mag: 1.58, bv: 0.03 },
    { name: 'Shaula', ra: 17.560, dec: -37.104, mag: 1.63, bv: -0.22 },
    { name: 'Gacrux', ra: 12.519, dec: -57.113, mag: 1.63, bv: 1.59 },
    { name: 'Bellatrix', ra: 5.418, dec: 6.350, mag: 1.64, bv: -0.22 },
    { name: 'Elnath', ra: 5.438, dec: 28.608, mag: 1.65, bv: -0.13 },
    { name: 'Miaplacidus', ra: 9.220, dec: -69.717, mag: 1.68, bv: 0.07 },
    { name: 'Alnilam', ra: 5.604, dec: -1.202, mag: 1.70, bv: -0.19 },
    { name: 'Alioth', ra: 12.901, dec: 55.960, mag: 1.77, bv: -0.02 },
    { name: 'Regor', ra: 8.158, dec: -47.337, mag: 1.78, bv: -0.26 },
    { name: 'Alnitak', ra: 5.679, dec: -1.943, mag: 1.79, bv: -0.21 },
    { name: 'Avior', ra: 8.375, dec: -59.509, mag: 1.86, bv: 1.25 },
    { name: 'Sargas', ra: 17.622, dec: -43.000, mag: 1.87, bv: 0.40 },
    { name: 'Mizar', ra: 13.792, dec: 49.313, mag: 1.86, bv: -0.19 },
    { name: 'Atria', ra: 16.811, dec: -69.028, mag: 1.91, bv: 1.44 },
    { name: 'Alhena', ra: 6.628, dec: 16.399, mag: 1.93, bv: 0.00 },
    { name: 'Peacock', ra: 20.428, dec: -56.735, mag: 1.94, bv: -0.20 },
    { name: 'Mirzam', ra: 6.378, dec: -17.956, mag: 1.98, bv: -0.23 },
    { name: 'Alphard', ra: 9.460, dec: -8.658, mag: 1.99, bv: 1.44 },
    { name: 'Polaris', ra: 2.531, dec: 89.264, mag: 1.98, bv: 0.60 },
    { name: 'Kaus Australis', ra: 18.403, dec: -34.384, mag: 1.85, bv: -0.03 },
    { name: 'Rasalhague', ra: 17.583, dec: 12.560, mag: 2.08, bv: 0.15 },
    { name: 'Saiph', ra: 5.794, dec: -9.670, mag: 2.06, bv: -0.17 },
    { name: 'Hamal', ra: 2.120, dec: 23.463, mag: 2.00, bv: 1.15 },
    { name: 'Alpheratz', ra: 0.139, dec: 29.091, mag: 2.06, bv: -0.11 },
    { name: 'Nunki', ra: 18.921, dec: -26.296, mag: 2.02, bv: -0.20 },
    { name: 'Ankaa', ra: 22.714, dec: -46.885, mag: 2.04, bv: 1.52 },
    { name: 'Menkent', ra: 14.112, dec: -36.369, mag: 2.06, bv: 1.02 },
    { name: 'Acrux', ra: 12.263, dec: -58.749, mag: 2.09, bv: -0.24 },
    { name: 'Ginan', ra: 12.448, dec: -63.099, mag: 2.08, bv: -0.26 }
];

function seededRandom(seedValue) {
    let s = seedValue >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function bv2rgb(THREE, bv) {
    const t = THREE.MathUtils.clamp(bv, -0.4, 2.0);
    if (t < 0.0) return [0.62 - t * 0.38, 0.76 + t * 0.16, 1.0];
    if (t < 0.5) return [1.0, 1.0 - t * 0.05, 1.0 - t * 0.22];
    if (t < 1.0) return [1.0, 0.98 - (t - 0.5) * 0.26, 0.86 - (t - 0.5) * 0.4];
    return [1.0, 0.82 - (t - 1.0) * 0.34, Math.max(0.18, 0.58 - (t - 1.0) * 0.34)];
}

function magToSize(THREE, mag, scale = 1) {
    return THREE.MathUtils.clamp(7.0 * Math.pow(2.512, -mag * 0.22) * scale, 0.45, 11.5);
}

function magToAlpha(THREE, mag, scale = 1) {
    return THREE.MathUtils.clamp(1.1 * Math.pow(2.512, -mag * 0.16) * scale, 0.12, 1.0);
}

// Regiuni reale de-a lungul benzii galactice (longitudine/latitudine galactica
// aproximative, din literatura astronomica) unde stelele se aglomereaza vizibil
// mai dens decat media benzii - nu sunt alese arbitrar, corespund unor structuri
// cunoscute (nori stelari, regiuni HII de formare stelara).
const milkyWayClusters = [
    { name: 'Sagittarius Star Cloud', l: 5.4, b: -1.0, count: 260, spread: 3.2, hot: false },
    { name: 'Scutum Star Cloud', l: 25.0, b: -0.3, count: 200, spread: 3.0, hot: false },
    { name: 'Carina Nebula region', l: 287.6, b: -0.6, count: 220, spread: 2.6, hot: true },
    { name: 'Cygnus star clouds', l: 80.0, b: 0.3, count: 220, spread: 3.4, hot: true },
    { name: 'Norma arm tangent', l: 328.0, b: -0.2, count: 160, spread: 2.8, hot: true },
    { name: 'Perseus arm tangent', l: 135.0, b: 0.5, count: 160, spread: 3.0, hot: false }
];

// Distanta unghiulara minima (circulara) de la longitudinea galactica l fata
// de centrul galactic (l=0).
function galacticCenterDistance(lDeg) {
    return Math.abs(((lDeg + 180) % 360 + 360) % 360 - 180);
}

// Profil de densitate pe longitudine: mai luminos/dens spre centrul galactic
// (bulge, l~0 - directia Sagittarius/Scorpius), mult mai slab spre anticentrul
// galactic (l~180 - Auriga/Taurus), plus "Great Rift"-ul - banda de praf
// absorbant care intuneca vizual Calea Lactee intre Cygnus si Sagittarius
// (l aprox 10-80 grade).
function galacticDensityAt(lDeg) {
    const d = galacticCenterDistance(lDeg);
    const bulge = Math.exp(-Math.pow(d / 55, 2));
    const riftCenter = 45;
    const riftWidth = 28;
    const riftFactor = 1 - 0.5 * Math.exp(-Math.pow((lDeg - riftCenter) / riftWidth, 2));
    return (0.3 + 0.7 * bulge) * riftFactor;
}

// Latimea benzii (in latitudine galactica) creste vizibil langa bulge - acolo
// norii stelari din centrul galaxiei ocupa un unghi mult mai mare pe cer decat
// restul benzii, subtire, vazuta tangential prin discul galactic.
function galacticLatitudeSigmaAt(lDeg, baseSigma) {
    const d = galacticCenterDistance(lDeg);
    const bulgeWidth = Math.exp(-Math.pow(d / 40, 2));
    return baseSigma + 5.5 * bulgeWidth;
}

export function createStarField(THREE, { radius = 42, seed = 1847 } = {}) {
    const visual = {
        namedSize: 1.42,
        namedAlpha: 1.18,
        milkyWaySize: 0.92,
        milkyWayAlpha: 0.86,
        backgroundSize: 0.56,
        backgroundAlpha: 0.24,
        clusterSize: 1.05,
        clusterAlpha: 0.92,
        galacticLatitudeSigma: 3.0,
        galacticLatitudeClamp: 15,
        rotation: {
            x: THREE.MathUtils.degToRad(-11),
            y: THREE.MathUtils.degToRad(32),
            z: THREE.MathUtils.degToRad(-18)
        }
    };

    const rand = seededRandom(seed);

    function gaussian() {
        const u = Math.max(1e-6, rand());
        const v = rand();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
    }

    function raDecToVec3(raHours, decDeg, target = new THREE.Vector3()) {
        const ra = raHours * Math.PI / 12;
        const dec = THREE.MathUtils.degToRad(decDeg);
        return target.set(
            radius * Math.cos(dec) * Math.cos(ra),
            radius * Math.sin(dec),
            radius * Math.cos(dec) * Math.sin(ra)
        );
    }

    function galacticToEquatorial(lDeg, bDeg, target = new THREE.Vector3()) {
        const raGp = THREE.MathUtils.degToRad(192.85948);
        const decGp = THREE.MathUtils.degToRad(27.12825);
        const lOmega = THREE.MathUtils.degToRad(32.93192);
        const l = THREE.MathUtils.degToRad(lDeg);
        const b = THREE.MathUtils.degToRad(bDeg);
        const sinDec = Math.sin(b) * Math.sin(decGp) + Math.cos(b) * Math.cos(decGp) * Math.sin(lOmega - l);
        const dec = Math.asin(THREE.MathUtils.clamp(sinDec, -1, 1));
        const y = Math.cos(b) * Math.cos(lOmega - l);
        const x = Math.sin(b) * Math.cos(decGp) - Math.cos(b) * Math.sin(decGp) * Math.sin(lOmega - l);
        const ra = Math.atan2(y, x) + raGp;
        return target.set(
            radius * Math.cos(dec) * Math.cos(ra),
            radius * Math.sin(dec),
            radius * Math.cos(dec) * Math.sin(ra)
        );
    }

    const starMaterial = new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    function makePoints(records, sizeScale = 1, alphaScale = 1) {
        const pos = new Float32Array(records.length * 3);
        const col = new Float32Array(records.length * 3);
        const size = new Float32Array(records.length);
        const alpha = new Float32Array(records.length);
        const tmp = new THREE.Vector3();
        records.forEach((star, i) => {
            const p = star.position || raDecToVec3(star.ra, star.dec, tmp);
            pos[i * 3] = p.x;
            pos[i * 3 + 1] = p.y;
            pos[i * 3 + 2] = p.z;
            const [r, g, b] = bv2rgb(THREE, star.bv);
            col[i * 3] = r;
            col[i * 3 + 1] = g;
            col[i * 3 + 2] = b;
            size[i] = magToSize(THREE, star.mag, sizeScale);
            alpha[i] = magToAlpha(THREE, star.mag, alphaScale);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
        return new THREE.Points(geo, starMaterial);
    }

    const backgroundStars = [];
    for (let i = 0; i < 4200; i++) {
        const c = rand() * 2 - 1;
        const p = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - c * c);
        const mag = 3.4 + Math.pow(rand(), 0.48) * 3.7;
        const colorRoll = rand();
        const bv = colorRoll < 0.15 ? -0.32 + rand() * 0.32 : colorRoll > 0.83 ? 0.95 + rand() * 0.9 : -0.05 + rand() * 0.78;
        backgroundStars.push({
            position: new THREE.Vector3(Math.cos(p) * s * radius, c * radius, Math.sin(p) * s * radius),
            mag,
            bv
        });
    }

    // Esantionare prin respingere (rejection sampling): alegem l uniform, apoi
    // acceptam punctul doar cu probabilitatea data de profilul real de
    // densitate galactica - rezultatul e o banda mai stralucitoare spre bulge
    // (l~0) si vizibil mai slaba spre anticentru (l~180), cu rift-ul intunecat
    // intre Cygnus si Sagittarius, in loc de o distributie uniforma pe 360°.
    const milkyWayStars = [];
    let guard = 0;
    while (milkyWayStars.length < 4500 && guard < 200000) {
        guard++;
        const armBias = rand() < 0.58 ? Math.sin(rand() * Math.PI * 8) * 9 : 0;
        const l = (rand() * 360 + armBias + 360) % 360;
        if (rand() > galacticDensityAt(l)) continue;
        const sigma = galacticLatitudeSigmaAt(l, visual.galacticLatitudeSigma);
        const b = THREE.MathUtils.clamp(gaussian() * sigma, -visual.galacticLatitudeClamp, visual.galacticLatitudeClamp);
        const mag = 3.1 + Math.pow(rand(), 0.42) * 3.9;
        const bv = rand() < 0.18 ? -0.25 + rand() * 0.35 : rand() < 0.78 ? 0.05 + rand() * 0.7 : 0.9 + rand() * 0.75;
        milkyWayStars.push({ position: galacticToEquatorial(l, b, new THREE.Vector3()), mag, bv });
    }

    // Clustere regionale numite (Sagittarius/Scutum star clouds, Carina,
    // Cygnus etc.) - aglomerari gaussiene locale in jurul coordonatelor
    // galactice reale ale acestor regiuni, cu o usoara predispozitie spre
    // culori mai calde/albastre pentru regiunile de formare stelara ("hot").
    const clusterStars = [];
    milkyWayClusters.forEach(cluster => {
        for (let i = 0; i < cluster.count; i++) {
            const l = cluster.l + gaussian() * cluster.spread;
            const b = cluster.b + gaussian() * cluster.spread * 0.55;
            const mag = 3.6 + Math.pow(rand(), 0.5) * 3.4;
            const bv = cluster.hot
                ? (rand() < 0.6 ? -0.28 + rand() * 0.3 : 0.05 + rand() * 0.5)
                : (rand() < 0.35 ? -0.1 + rand() * 0.4 : 0.4 + rand() * 0.9);
            clusterStars.push({ position: galacticToEquatorial(l, b, new THREE.Vector3()), mag, bv });
        }
    });

    const group = new THREE.Group();
    const namedPoints = makePoints(namedCatalog, visual.namedSize, visual.namedAlpha);
    const milkyWayPoints = makePoints(milkyWayStars, visual.milkyWaySize, visual.milkyWayAlpha);
    const clusterPoints = makePoints(clusterStars, visual.clusterSize, visual.clusterAlpha);
    const backgroundPoints = makePoints(backgroundStars, visual.backgroundSize, visual.backgroundAlpha);
    namedPoints.userData.namedStars = namedCatalog;
    group.add(backgroundPoints, milkyWayPoints, clusterPoints, namedPoints);
    group.rotation.set(visual.rotation.x, visual.rotation.y, visual.rotation.z);
    group.userData = {
        visual,
        namedStars: namedCatalog,
        milkyWayClusters,
        counts: {
            named: namedCatalog.length,
            milkyWay: milkyWayStars.length,
            clusters: clusterStars.length,
            background: backgroundStars.length,
            total: namedCatalog.length + milkyWayStars.length + clusterStars.length + backgroundStars.length
        }
    };
    return group;
}
