import { fetchEarthCelesTrakTle } from './earth-data-runtime.js?v=unifiedEarthLot2';

const SATELLITE_JS_URLS = [
    'https://cdn.jsdelivr.net/npm/satellite.js@6.0.2/+esm',
    'https://esm.sh/satellite.js@6.0.2'
];
const ISS_TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE';
const NETWORK_TIMEOUT_MS = 8500;
const ISS_BUNDLED_TLE = {
    line1: '1 25544U 98067A   26189.73419088  .00005258  00000+0  10370-3 0  9999',
    line2: '2 25544  51.6304 193.4497 0006669 272.1743  87.8481 15.48947664575097',
    source: 'bundled-celestrak-2026-07-08'
};
const EARTH_RADIUS_KM = 6371;
const EARTH_SCENE_RADIUS = 2.0; // trebuie sa coincida cu raza geometriei Earth din earth-layers.js
const ISS_FALLBACK_ALTITUDE_KM = 408; // altitudine medie reala ISS, doar ca valoare initiala de stare
const ISS_TRAIL_SAMPLE_COUNT = 72;
const ISS_TRAIL_PAST_MINUTES = 44;
const ISS_TRAIL_FUTURE_MINUTES = 12;
const ISS_TRAIL_REFRESH_MS = 12 * 1000;

function formatIssAltitude(km) {
    if (!Number.isFinite(km)) return 'unknown altitude';
    return `${Math.round(km)} km alt`;
}

function formatIssSpeed(velocityEci) {
    if (!velocityEci) return 'unknown speed';
    const speedKmS = Math.sqrt(
        velocityEci.x * velocityEci.x +
        velocityEci.y * velocityEci.y +
        velocityEci.z * velocityEci.z
    );
    if (!Number.isFinite(speedKmS)) return 'unknown speed';
    return `${speedKmS.toFixed(2)} km/s`;
}

function updateIssStatus(state) {
    const status = document.getElementById('issStatus');
    if (!status) return;
    if (!state.enabled) {
        status.dataset.state = 'off';
        status.textContent = 'ISS: off';
        status.title = 'International Space Station layer disabled';
        return;
    }
    status.dataset.state = state.loading ? 'pending' : state.visible ? 'on' : state.source === 'unavailable' ? 'error' : 'pending';
    if (state.loading) {
        status.textContent = 'ISS: acquiring TLE / SGP4 fix...';
        return;
    }
    if (state.source === 'unavailable') {
        status.textContent = 'ISS: tracking unavailable';
        return;
    }
    if (!state.visible) {
        status.textContent = 'ISS: acquiring TLE / SGP4 fix...';
        return;
    }
    status.textContent = `ISS: ${formatIssAltitude(state.altitudeKm)} · ${formatIssSpeed(state.velocityEci)}`;
    status.title = `International Space Station — NORAD 25544, SGP4 propagated from CelesTrak TLE, source: ${state.source}`;
}

// Punct luminos simplu — ISS nu are disc rezolvabil la aceasta scara,
// e un punct stelar foarte stralucitor (magnitudine pana la -4, mai luminos decat Venus).
function withTimeout(promise, ms, label) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function createIssPointTexture(THREE) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const center = 64;
    const glow = ctx.createRadialGradient(center, center, 0, center, center, 60);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.18, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.45, 'rgba(225,238,255,0.35)');
    glow.addColorStop(1, 'rgba(225,238,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

// Eticheta discreta "ISS" — card mic, mereu vizibil (depthTest:false, ca reelCaption),
// independent de modul reel/cinematic. Doar identifica punctul, fara alte date.
function createIssLabelTexture(THREE) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const x = 4, y = 4, w = canvas.width - 8, h = canvas.height - 8, radius = 16;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    ctx.fillStyle = 'rgba(8, 14, 26, 0.74)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(160, 200, 255, 0.30)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(225, 238, 255, 0.92)';
    ctx.font = '600 36px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('ISS', x + 20, y + h / 2 + 1);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function createIssTrailMaterial(THREE) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(0x9fd6ff) },
            uOpacity: { value: 0.15 },
            uTime: { value: 0 }
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            attribute float aAlpha;
            varying float vAlpha;
            void main() {
                vAlpha = aAlpha;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            varying float vAlpha;
            void main() {
                float pulse = 0.92 + 0.08 * sin(uTime * 1.35);
                gl_FragColor = vec4(uColor, vAlpha * uOpacity * pulse);
            }
        `
    });
}

export function createIssSystem({
    THREE,
    scene,
    lonLatToVec3,
    getDate = () => new Date(),
    tleRefreshMs = 3 * 60 * 60 * 1000 // CelesTrak actualizeaza TLE-urile de cateva ori/zi; 3h e suficient de des
}) {
    const ISS_POINT_SIZE = 0.045;
    const ISS_HALO_SIZE = 0.085;

    const state = {
        enabled: false,
        loading: false,
        visible: false,
        source: 'pending',
        latitude: 0,
        longitude: 0,
        altitudeKm: ISS_FALLBACK_ALTITUDE_KM,
        velocityEci: null
    };

    const issGeometry = new THREE.PlaneGeometry(1, 1, 2, 2);

    const issMat = new THREE.MeshBasicMaterial({
        map: createIssPointTexture(THREE),
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
    });
    const iss = new THREE.Mesh(issGeometry, issMat);
    iss.name = 'iss-station';
    iss.visible = false;
    iss.renderOrder = 7;
    iss.scale.setScalar(ISS_POINT_SIZE);
    iss.userData.specialId = 'iss';
    scene.add(iss);

    const issHalo = new THREE.Mesh(issGeometry.clone(), new THREE.MeshBasicMaterial({
        map: createIssPointTexture(THREE),
        color: 0x9fc8ff,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
    }));
    issHalo.name = 'iss-station-halo';
    issHalo.visible = false;
    issHalo.renderOrder = 6;
    issHalo.scale.setScalar(ISS_HALO_SIZE);
    issHalo.userData.specialId = 'iss';
    scene.add(issHalo);

    const issLabel = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
            map: createIssLabelTexture(THREE),
            transparent: true,
            opacity: 0.82,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        })
    );
    issLabel.visible = false;
    issLabel.renderOrder = 950;
    scene.add(issLabel);

    const issLineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const issLine = new THREE.Line(
        issLineGeometry,
        new THREE.LineBasicMaterial({
            color: 0xaac4e8,
            transparent: true,
            opacity: 0.4,
            depthTest: false,
            depthWrite: false
        })
    );
    issLine.visible = false;
    issLine.renderOrder = 949;
    scene.add(issLine);

    const issTrailGeometry = new THREE.BufferGeometry();
    issTrailGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(ISS_TRAIL_SAMPLE_COUNT * 3), 3)
    );
    issTrailGeometry.setAttribute(
        'aAlpha',
        new THREE.BufferAttribute(new Float32Array(ISS_TRAIL_SAMPLE_COUNT), 1)
    );
    const issTrail = new THREE.Line(issTrailGeometry, createIssTrailMaterial(THREE));
    issTrail.name = 'iss-orbital-trail';
    issTrail.visible = false;
    issTrail.renderOrder = 5;
    issTrail.frustumCulled = false;
    scene.add(issTrail);

    // Vectori temporari refolositi in update(), evitam alocari noi in fiecare frame.
    const _camRight = new THREE.Vector3();
    const _camUp = new THREE.Vector3();
    const _labelOffset = new THREE.Vector3();
    const _lineEnd = new THREE.Vector3();

    let satelliteLib = null;
    let satelliteLoadPromise = null;
    let satelliteLoadFailed = false;
    let satrec = null;
    let tleIntervalId = null;
    let lastTrailUpdateMs = 0;

    function hideIssObjects() {
        iss.visible = false;
        issHalo.visible = false;
        issLabel.visible = false;
        issLine.visible = false;
        issTrail.visible = false;
    }

    function propagateToScenePosition(sampleDate) {
        const positionAndVelocity = satelliteLib.propagate(satrec, sampleDate);
        if (!positionAndVelocity || !positionAndVelocity.position) return null;
        const gmst = satelliteLib.gstime(sampleDate);
        const geodetic = satelliteLib.eciToGeodetic(positionAndVelocity.position, gmst);
        const longitude = geodetic.longitude * 180 / Math.PI;
        const latitude = geodetic.latitude * 180 / Math.PI;
        const altitudeKm = Number.isFinite(geodetic.height) ? geodetic.height : ISS_FALLBACK_ALTITUDE_KM;
        const sceneRadius = EARTH_SCENE_RADIUS + (altitudeKm / EARTH_RADIUS_KM) * EARTH_SCENE_RADIUS;
        return lonLatToVec3(longitude, latitude, sceneRadius);
    }

    function updateTrail(now) {
        if (!state.enabled || !satrec || !satelliteLib) {
            issTrail.visible = false;
            return;
        }

        const nowMs = now.getTime();
        if (nowMs - lastTrailUpdateMs < ISS_TRAIL_REFRESH_MS && issTrail.visible) return;
        lastTrailUpdateMs = nowMs;

        const positions = issTrailGeometry.attributes.position.array;
        const alphas = issTrailGeometry.attributes.aAlpha.array;
        const totalMinutes = ISS_TRAIL_PAST_MINUTES + ISS_TRAIL_FUTURE_MINUTES;
        const currentNorm = ISS_TRAIL_PAST_MINUTES / totalMinutes;
        let validSamples = 0;

        for (let i = 0; i < ISS_TRAIL_SAMPLE_COUNT; i++) {
            const t = i / (ISS_TRAIL_SAMPLE_COUNT - 1);
            const minutes = -ISS_TRAIL_PAST_MINUTES + t * totalMinutes;
            const sampleDate = new Date(nowMs + minutes * 60 * 1000);
            const point = propagateToScenePosition(sampleDate);
            const base = i * 3;
            if (!point) {
                positions[base] = 0;
                positions[base + 1] = 0;
                positions[base + 2] = 0;
                alphas[i] = 0;
                continue;
            }

            positions[base] = point.x;
            positions[base + 1] = point.y;
            positions[base + 2] = point.z;

            const relativeToNow = Math.abs(t - currentNorm) / Math.max(currentNorm, 1 - currentNorm);
            const focus = Math.pow(Math.max(0, 1 - relativeToNow), 1.55);
            const oldFade = Math.min(1, t / 0.16);
            const futureFade = Math.min(1, (1 - t) / 0.10);
            alphas[i] = focus * oldFade * futureFade;
            validSamples++;
        }

        issTrailGeometry.attributes.position.needsUpdate = true;
        issTrailGeometry.attributes.aAlpha.needsUpdate = true;
        issTrailGeometry.computeBoundingSphere();
        issTrail.visible = validSamples > 3;
    }

    async function loadSatelliteJs() {
        if (satelliteLib || satelliteLoadFailed) return satelliteLib;
        if (!satelliteLoadPromise) {
            satelliteLoadPromise = (async () => {
                for (const url of SATELLITE_JS_URLS) {
                    try {
                        const module = await withTimeout(import(url), NETWORK_TIMEOUT_MS, `satellite.js import ${url}`);
                        satelliteLib = module;
                        return module;
                    } catch (error) {
                        console.warn(`[ISS] satellite.js import failed from ${url}.`, error);
                    }
                }
                satelliteLoadFailed = true;
                console.warn('[ISS] satellite.js unavailable; ISS tracking disabled.');
                return null;
            })();
        }
        return satelliteLoadPromise;
    }

    function parseTleResponse(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const line1 = lines.find(l => l.startsWith('1 '));
        const line2 = lines.find(l => l.startsWith('2 '));
        if (!line1 || !line2) throw new Error('TLE response did not contain valid lines 1/2');
        return { line1, line2 };
    }

    async function refreshTle() {
        if (!state.enabled) {
            state.loading = false;
            state.visible = false;
            hideIssObjects();
            updateIssStatus(state);
            return;
        }
        state.loading = true;
        updateIssStatus(state);
        const satellite = await loadSatelliteJs();
        state.loading = false;
        if (!satellite) {
            state.source = 'unavailable';
            state.visible = false;
            hideIssObjects();
            updateIssStatus(state);
            return;
        }
        try {
            const result = await fetchEarthCelesTrakTle(ISS_TLE_URL);
            const text = result.data;
            const { line1, line2 } = parseTleResponse(text);
            satrec = satellite.twoline2satrec(line1, line2);
            state.source = result.state === 'stale' ? 'cached-celestrak' : 'celestrak';
        } catch (error) {
            console.warn('[ISS] TLE fetch failed; keeping last known orbit or fallback if available.', error);
            if (!satrec) {
                const fallbackTle = ISS_BUNDLED_TLE;
                if (fallbackTle?.line1 && fallbackTle?.line2) {
                    satrec = satellite.twoline2satrec(fallbackTle.line1, fallbackTle.line2);
                    state.source = fallbackTle.source || 'cached-celestrak';
                } else {
                    state.source = 'unavailable';
                    state.visible = false;
                    hideIssObjects();
                    updateIssStatus(state);
                }
            }
        }
    }

    function updatePosition(now) {
        if (!state.enabled) return;
        if (!satrec || !satelliteLib) return;
        const positionAndVelocity = satelliteLib.propagate(satrec, now);
        if (!positionAndVelocity || !positionAndVelocity.position) {
            state.visible = false;
            hideIssObjects();
            updateIssStatus(state);
            return;
        }
        const gmst = satelliteLib.gstime(now);
        const geodetic = satelliteLib.eciToGeodetic(positionAndVelocity.position, gmst);
        state.longitude = geodetic.longitude * 180 / Math.PI;
        state.latitude = geodetic.latitude * 180 / Math.PI;
        state.altitudeKm = geodetic.height;
        state.velocityEci = positionAndVelocity.velocity;

        const sceneRadius = EARTH_SCENE_RADIUS + (state.altitudeKm / EARTH_RADIUS_KM) * EARTH_SCENE_RADIUS;
        iss.position.copy(lonLatToVec3(state.longitude, state.latitude, sceneRadius));
        issHalo.position.copy(iss.position);
        updateTrail(now);

        iss.visible = true;
        issHalo.visible = true;
        state.visible = true;
        updateIssStatus(state);
    }

    // Spre deosebire de Luna (update doar de fiecare 60s + lookAt per-frame),
    // ISS se misca la 7.66 km/s — pozitia trebuie recalculata in fiecare frame.
    // SGP4 propagate() e ieftin (zero retea), deci nu costa nimic sa o facem aici.
    function update(camera) {
        if (!state.enabled) return;
        updatePosition(getDate());
        if (!state.visible) {
            issLabel.visible = false;
            issLine.visible = false;
            return;
        }
        if (!camera) return;
        iss.lookAt(camera.position);
        issHalo.lookAt(camera.position);
        if (issTrail.material && issTrail.material.uniforms) {
            issTrail.material.uniforms.uTime.value = performance.now() * 0.001;
        }

        // Eticheta discreta + linia conectoare, mereu deasupra (depthTest:false),
        // pozitionata in spatiul camerei (right/up), nu in lumea 3D.
        const labelDistance = camera.position.distanceTo(iss.position);
        const labelScale = labelDistance * 0.05;
        _camRight.setFromMatrixColumn(camera.matrixWorld, 0);
        _camUp.setFromMatrixColumn(camera.matrixWorld, 1);
        _labelOffset.copy(_camRight).multiplyScalar(labelScale * 1.35)
            .addScaledVector(_camUp, labelScale * 0.55);
        issLabel.position.copy(iss.position).add(_labelOffset);
        issLabel.quaternion.copy(camera.quaternion);
        issLabel.scale.set(labelScale * 2.15, labelScale * 0.82, 1);
        issLabel.visible = true;

        _lineEnd.copy(issLabel.position).addScaledVector(_camRight, -labelScale * 1.2);
        issLineGeometry.setFromPoints([iss.position, _lineEnd]);
        issLineGeometry.attributes.position.needsUpdate = true;
        issLine.material.opacity = 0.28;
        issLine.visible = true;
    }

    function start() {
        updateIssStatus(state);
        if (tleIntervalId !== null) return;
        tleIntervalId = setInterval(refreshTle, tleRefreshMs);
    }

    function stop() {
        if (tleIntervalId === null) return;
        clearInterval(tleIntervalId);
        tleIntervalId = null;
    }

    async function setEnabled(enabled) {
        state.enabled = Boolean(enabled);
        if (!state.enabled) {
            state.loading = false;
            state.visible = false;
            hideIssObjects();
            updateIssStatus(state);
            return state;
        }
        await refreshTle();
        updatePosition(getDate());
        updateIssStatus(state);
        return state;
    }

    async function toggle() {
        return setEnabled(!state.enabled);
    }

    return {
        iss,
        issHalo,
        issLabel,
        issLine,
        issTrail,
        issState: state,
        start,
        stop,
        setEnabled,
        toggle,
        update,
        refreshTle
    };
}
