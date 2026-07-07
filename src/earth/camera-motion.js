export function createCameraMotionRuntime({
    THREE,
    state,
    camera,
    controls,
    motionPresets,
    heroDriftProfiles,
    eventCategory,
    lonLatToVec3,
    getTime,
    applyExportCameraFramingTo,
    updateGuide916,
    updateMotionPresetUi
}) {
    const focus = {
        active: false,
        fromPos: new THREE.Vector3(),
        toPos: new THREE.Vector3(),
        fromTarget: new THREE.Vector3(),
        toTarget: new THREE.Vector3(),
        start: 0,
        duration: 1.45
    };

    const selectedCinematic = {
        active: false,
        lon: 0,
        lat: 0,
        distance: 3.72,
        surface: new THREE.Vector3(),
        side: new THREE.Vector3(1, 0, 0),
        upBias: new THREE.Vector3(0, 0.26, 0),
        target: new THREE.Vector3(),
        phaseStart: 0
    };

    const scratch = {
        surface: new THREE.Vector3(),
        side: new THREE.Vector3(),
        verticalAxis: new THREE.Vector3(),
        desiredTarget: new THREE.Vector3(),
        targetSide: new THREE.Vector3()
    };

    // Urmarire continua ISS — separat complet de focus/selectedCinematic,
    // ca sa nu riscam nimic din mecanica de reel/eveniment deja existenta.
    // ISS se misca la 7.66 km/s: tinta trebuie recalculata in fiecare frame
    // din pozitia LIVE (issStateRef), nu inghetata la momentul click-ului.
    const issCam = {
        active: false,
        transitioning: false,
        distance: 3.6, // peste controls.minDistance (3.1) din scene-runtime.js, evita "intrarea" in nori
        fromPos: new THREE.Vector3(),
        fromTarget: new THREE.Vector3(),
        start: 0,
        duration: 1.6,
        issStateRef: null
    };
    const _issUp = new THREE.Vector3(0, 0.18, 0);
    const _issSurface = new THREE.Vector3();
    const _issSide = new THREE.Vector3();
    const _issTarget = new THREE.Vector3();
    const _issDesiredPos = new THREE.Vector3();
    const _issFromDir = new THREE.Vector3();
    const _issToDir = new THREE.Vector3();
    const _issQuatDelta = new THREE.Quaternion();
    const _issQuatCurrent = new THREE.Quaternion();

    // Limite OrbitControls separate pentru Pamant si Luna - controls.minDistance/
    // maxDistance sunt GLOBALE in Three.js (nu tin cont de ce obiect e target),
    // deci daca lasam valorile calibrate pentru Pamant (raza 2.0) active cat
    // timp target=Luna (raza 0.1), utilizatorul e fortat sa stea la 3.1-12
    // unitati de un corp de 20x mai mic - exact cauza "micsorarii" la orice
    // interactiune manuala. Comutam explicit la momentele potrivite.
    const EARTH_ORBIT_MIN = 3.1;
    const EARTH_ORBIT_MAX = 12;
    const MOON_ORBIT_MIN = 0.16;
    const MOON_ORBIT_MAX = 2.5;
    // camera.near=0.1 e calibrat pentru Pamant (minDistance 3.1, mult peste 0.1).
    // La Luna (raza reala ~0.1 unitati), punctul cel mai apropiat al sferei fata
    // de camera poate ajunge SUB 0.1 - planul de clipping apropiat "taie" centrul
    // sferei, lasand vizibila doar marginea (efectul de "gaura/tunel" observat).
    const EARTH_CAMERA_NEAR = 0.1;
    const MOON_CAMERA_NEAR = 0.01;

    function useEarthOrbitBounds() {
        controls.minDistance = EARTH_ORBIT_MIN;
        controls.maxDistance = EARTH_ORBIT_MAX;
        if (camera.near !== EARTH_CAMERA_NEAR) {
            camera.near = EARTH_CAMERA_NEAR;
            camera.updateProjectionMatrix();
        }
    }

    function useMoonOrbitBounds() {
        controls.minDistance = MOON_ORBIT_MIN;
        controls.maxDistance = MOON_ORBIT_MAX;
        if (camera.near !== MOON_CAMERA_NEAR) {
            camera.near = MOON_CAMERA_NEAR;
            camera.updateProjectionMatrix();
        }
    }

    function startIssTracking(issStateRef) {
        if (!issStateRef) return;
        useEarthOrbitBounds();
        clearSelectedCinematic();
        issCam.issStateRef = issStateRef;
        issCam.fromPos.copy(camera.position);
        issCam.fromTarget.copy(controls.target);
        issCam.start = getTime();
        issCam.transitioning = true;
        issCam.active = true;
        controls.autoRotate = false;
    }

    function stopIssTracking() {
        if (!issCam.active) return;
        issCam.active = false;
        issCam.transitioning = false;
        issCam.issStateRef = null;
        controls.autoRotate = true;
    }

    // Elibereaza automat urmarirea daca utilizatorul trage manual camera.
    controls.addEventListener('start', () => {
        if (issCam.active) stopIssTracking();
        if (moonCam.active) stopMoonTracking();
        if (moonMarkerCam.active) stopMoonMarkerFocus();
    });

    function updateIssTracking(t) {
        if (!issCam.active || !issCam.issStateRef) return false;
        lonLatToVec3(issCam.issStateRef.longitude, issCam.issStateRef.latitude, 2.0, _issSurface).normalize();
        _issSide.set(0, 1, 0).cross(_issSurface).normalize();
        if (!Number.isFinite(_issSide.x)) _issSide.set(1, 0, 0);
        _issTarget.copy(_issSurface).multiplyScalar(0.28);
        _issDesiredPos.copy(_issSurface).multiplyScalar(issCam.distance)
            .addScaledVector(_issSide, 0.32)
            .add(_issUp);

        if (issCam.transitioning) {
            const k = Math.min(1, (t - issCam.start) / issCam.duration);
            const eased = k * k * (3 - 2 * k);
            // Interpolare pe arc sferic (slerp prin quaternion), NU pe linie dreapta —
            // o linie dreapta intre doua puncte de pe glob taie prin interiorul Pamantului
            // cand tinta e pe partea opusa fata de pozitia initiala a camerei.
            _issFromDir.copy(issCam.fromPos).normalize();
            _issToDir.copy(_issDesiredPos).normalize();
            _issQuatDelta.setFromUnitVectors(_issFromDir, _issToDir);
            _issQuatCurrent.identity().slerp(_issQuatDelta, eased);
            const fromMag = issCam.fromPos.length();
            const toMag = _issDesiredPos.length();
            camera.position.copy(_issFromDir).applyQuaternion(_issQuatCurrent)
                .multiplyScalar(THREE.MathUtils.lerp(fromMag, toMag, eased));
            controls.target.lerpVectors(issCam.fromTarget, _issTarget, eased);
            if (k >= 1) issCam.transitioning = false;
        } else {
            camera.position.lerp(_issDesiredPos, 0.05);
            controls.target.lerp(_issTarget, 0.08);
        }
        camera.lookAt(controls.target);
        return true;
    }

    // Zbor cinematic simplu catre Luna — nu urmarire continua ca la ISS,
    // pentru ca Luna nu se misca vizibil in cateva secunde. Camera se
    // pozitioneaza pe partea ILUMINATA (spre Soare, nu opusa Pamantului) —
    // altfel, la Luna aproape plina, zborul "dincolo de Luna fata de Pamant"
    // duce exact pe partea intunecata (Soare aproape opus Lunii vazuta de pe
    // Pamant la faze mari). Aproximarea de directie a Soarelui e valida si
    // pentru Luna (distanta Soare-Pamant >> distanta Pamant-Luna).
    const moonCam = {
        active: false,
        transitioning: false,
        distance: 0.82, // cadru mai aerisit pentru reel: Luna ramane mare, dar camera nu "cade" pe suprafata
        fromPos: new THREE.Vector3(),
        fromTarget: new THREE.Vector3(),
        start: 0,
        duration: 4.4, // zbor calm prin spatiu, fara senzatie de cut/teleport
        moonObjectRef: null,
        sunDirRef: null
    };
    const _moonTarget = new THREE.Vector3();
    const _moonDesiredPos = new THREE.Vector3();
    const _moonRadialDir = new THREE.Vector3();
    const _moonFromDir = new THREE.Vector3();
    const _moonToDir = new THREE.Vector3();
    const _moonQuatDelta = new THREE.Quaternion();
    const _moonQuatCurrent = new THREE.Quaternion();

    function startMoonTracking(moonObject, sunDirWorld) {
        if (!moonObject) return;
        useMoonOrbitBounds();
        clearSelectedCinematic();
        if (issCam.active) stopIssTracking();
        moonCam.moonObjectRef = moonObject;
        moonCam.sunDirRef = sunDirWorld || null; // referinta live (moonState.sunWorldDir), nu clona
        moonCam.fromPos.copy(camera.position);
        moonCam.fromTarget.copy(controls.target);
        moonCam.start = getTime();
        moonCam.transitioning = true;
        moonCam.active = true;
        controls.autoRotate = false;
    }

    function stopMoonTracking() {
        if (!moonCam.active) return;
        moonCam.active = false;
        moonCam.transitioning = false;
        moonCam.moonObjectRef = null;
        moonCam.sunDirRef = null;
        controls.autoRotate = true;
    }

    let _moonDebugFrames = 0;
    function updateMoonTracking(t) {
        if (!moonCam.active || !moonCam.moonObjectRef) return false;
        _moonTarget.copy(moonCam.moonObjectRef.position);
        // Directia de apropiere: spre Soare (emisfera iluminata curenta) daca
        // avem directia reala; altfel fallback la radial-Pamant (comportament vechi).
        if (moonCam.sunDirRef) {
            _moonRadialDir.copy(moonCam.sunDirRef);
        } else {
            _moonRadialDir.copy(_moonTarget).normalize();
        }
        _moonDesiredPos.copy(_moonTarget).addScaledVector(_moonRadialDir, moonCam.distance);

        if (moonCam.transitioning) {
            const k = Math.min(1, (t - moonCam.start) / moonCam.duration);
            const eased = k * k * (3 - 2 * k);
            // Aceeasi interpolare pe arc sferic (slerp) ca la ISS — magnitudinea
            // interpolata liniar intre fromMag si toMag nu poate scadea sub
            // minimul celor doua, deci ramane mereu in afara Pamantului (r=2.0).
            _moonFromDir.copy(moonCam.fromPos).normalize();
            _moonToDir.copy(_moonDesiredPos).normalize();
            _moonQuatDelta.setFromUnitVectors(_moonFromDir, _moonToDir);
            _moonQuatCurrent.identity().slerp(_moonQuatDelta, eased);
            const fromMag = moonCam.fromPos.length();
            const toMag = _moonDesiredPos.length();
            camera.position.copy(_moonFromDir).applyQuaternion(_moonQuatCurrent)
                .multiplyScalar(THREE.MathUtils.lerp(fromMag, toMag, eased));
            controls.target.lerpVectors(moonCam.fromTarget, _moonTarget, eased);
            if (k >= 1) moonCam.transitioning = false;
        } else {
            camera.position.lerp(_moonDesiredPos, 0.05);
            controls.target.lerp(_moonTarget, 0.08);
        }
        camera.lookAt(controls.target);
        return true;
    }

    // Zbor cinematic catre un reper de pe suprafata Lunii (marker), similar
    // structural cu moonCam de mai sus - aceeasi interpolare pe arc sferic
    // (slerp) in timpul tranzitiei, apoi urmarire continua prin lerp simplu,
    // pentru ca marker-ul isi schimba pozitia in lume pe masura ce Luna se
    // roteste/orbiteaza (foarte lent, dar tot trebuie urmarit ca sa ramana
    // centrat daca privitorul sta mai mult pe acel reper).
    const moonMarkerCam = {
        active: false,
        transitioning: false,
        distance: 0.16, // apropiere de suprafata - MOON_ORBIT_MIN de mai jos permite exact atat
        fromPos: new THREE.Vector3(),
        fromTarget: new THREE.Vector3(),
        start: 0,
        duration: 2.4,
        markerRef: null,
        moonObjectRef: null
    };
    const _markerWorldPos = new THREE.Vector3();
    const _markerRadialDir = new THREE.Vector3();
    const _markerDesiredPos = new THREE.Vector3();
    const _markerFromDir = new THREE.Vector3();
    const _markerToDir = new THREE.Vector3();
    const _markerQuatDelta = new THREE.Quaternion();
    const _markerQuatCurrent = new THREE.Quaternion();

    function startMoonMarkerFocus(markerMesh, moonObject) {
        if (!markerMesh || !moonObject) return;
        useMoonOrbitBounds();
        clearSelectedCinematic();
        if (issCam.active) stopIssTracking();
        if (moonCam.active) stopMoonTracking();
        moonMarkerCam.markerRef = markerMesh;
        moonMarkerCam.moonObjectRef = moonObject;
        moonMarkerCam.fromPos.copy(camera.position);
        moonMarkerCam.fromTarget.copy(controls.target);
        moonMarkerCam.start = getTime();
        moonMarkerCam.transitioning = true;
        moonMarkerCam.active = true;
        controls.autoRotate = false;
    }

    function stopMoonMarkerFocus() {
        if (!moonMarkerCam.active) return;
        moonMarkerCam.active = false;
        moonMarkerCam.transitioning = false;
        moonMarkerCam.markerRef = null;
        moonMarkerCam.moonObjectRef = null;
        controls.autoRotate = true;
    }

    function updateMoonMarkerFocus(t) {
        if (!moonMarkerCam.active || !moonMarkerCam.markerRef) return false;
        moonMarkerCam.markerRef.getWorldPosition(_markerWorldPos);
        _markerRadialDir.copy(_markerWorldPos).sub(moonMarkerCam.moonObjectRef.position).normalize();
        _markerDesiredPos.copy(_markerWorldPos).addScaledVector(_markerRadialDir, moonMarkerCam.distance);

        if (moonMarkerCam.transitioning) {
            const k = Math.min(1, (t - moonMarkerCam.start) / moonMarkerCam.duration);
            const eased = k * k * (3 - 2 * k);
            _markerFromDir.copy(moonMarkerCam.fromPos).normalize();
            _markerToDir.copy(_markerDesiredPos).normalize();
            _markerQuatDelta.setFromUnitVectors(_markerFromDir, _markerToDir);
            _markerQuatCurrent.identity().slerp(_markerQuatDelta, eased);
            const fromMag = moonMarkerCam.fromPos.length();
            const toMag = _markerDesiredPos.length();
            camera.position.copy(_markerFromDir).applyQuaternion(_markerQuatCurrent)
                .multiplyScalar(THREE.MathUtils.lerp(fromMag, toMag, eased));
            controls.target.lerpVectors(moonMarkerCam.fromTarget, _markerWorldPos, eased);
            if (k >= 1) moonMarkerCam.transitioning = false;
        } else {
            camera.position.lerp(_markerDesiredPos, 0.06);
            controls.target.lerp(_markerWorldPos, 0.09);
        }
        camera.lookAt(controls.target);
        return true;
    }

    // Zbor de intoarcere de la Luna spre un cadru normal de orbita Pamant -
    // simetric cu startMoonTracking, dar mult mai simplu: NU are nevoie de
    // arc/slerp, pentru ca directia ramane EXACT aceeasi (doar raza scade de
    // la ~13.5-13.9 la o distanta normala de orbita) - o simpla "tragere
    // inapoi" de-a lungul aceleiasi raze din centrul Pamantului, garantat
    // sigura (raza scade monoton, nu poate trece niciodata prin Pamant).
    // Fara asta, la oprirea urmaririi Lunii, heroDrift prelua camera brusc
    // si clamp-ul lui de distanta (camDist > 9.0 -> setLength(9.0)) facea
    // un "salt" instant intr-un singur cadru - exact flash-ul vizual sesizat.
    const returnCam = {
        active: false,
        transitioning: false,
        distance: 6.4, // aceeasi distanta ca pozitia initiala din earth-app-bootstrap.js
        fromPos: new THREE.Vector3(),
        fromTarget: new THREE.Vector3(),
        start: 0,
        duration: 4.0 // revenire calma, dar incape in finalul reel-ului cand pulloutAt respecta presetul
    };
    const _returnTarget = new THREE.Vector3(0, 0, 0);
    const _returnDesiredPos = new THREE.Vector3();
    const _returnDir = new THREE.Vector3();

    function startReturnFromMoon(distance = returnCam.distance) {
        if (issCam.active) stopIssTracking();
        if (moonCam.active) stopMoonTracking();
        if (moonMarkerCam.active) stopMoonMarkerFocus();
        useEarthOrbitBounds();
        clearSelectedCinematic();
        returnCam.distance = distance;
        returnCam.fromPos.copy(camera.position);
        returnCam.fromTarget.copy(controls.target);
        returnCam.start = getTime();
        returnCam.transitioning = true;
        returnCam.active = true;
        controls.autoRotate = false;
    }

    let _returnDebugFrames = 0;
    function updateReturnFromMoon(t) {
        if (!returnCam.active) return false;
        _returnDir.copy(returnCam.fromPos).normalize();
        _returnDesiredPos.copy(_returnDir).multiplyScalar(returnCam.distance);

        const k = Math.min(1, (t - returnCam.start) / returnCam.duration);
        const eased = k * k * (3 - 2 * k);
        camera.position.lerpVectors(returnCam.fromPos, _returnDesiredPos, eased);
        controls.target.lerpVectors(returnCam.fromTarget, _returnTarget, eased);
        camera.lookAt(controls.target);

        if (k >= 1) {
            returnCam.transitioning = false;
            returnCam.active = false;
            controls.autoRotate = true;
        }
        return true;
    }

    function clusterScreenPresenceScore(cluster) {
        const surface = lonLatToVec3(cluster.lon, cluster.lat, 2.0).normalize();
        const cameraDir = camera.position.clone().normalize();
        const facing = surface.dot(cameraDir);
        if (facing <= 0.08) return -Infinity;
        return facing * 1.3 + cluster.recency * 1.5 + Math.min(cluster.count, 8) * 0.18;
    }

    function findClusterForEventId(eventId) {
        if (!eventId) return null;
        return state.clusters.find(cluster => cluster.primary.id === eventId || cluster.events?.some(event => event.id === eventId)) || null;
    }

    function heroDriftAnchor() {
        const leadCluster = findClusterForEventId(state.todayLeadId);
        if (leadCluster && clusterScreenPresenceScore(leadCluster) > -Infinity) return leadCluster;
        return [...state.clusters]
            .sort((a, b) => clusterScreenPresenceScore(b) - clusterScreenPresenceScore(a))[0] || null;
    }

    function heroDriftProfileFor(cluster) {
        const category = cluster?.category || eventCategory(cluster?.primary || {});
        return heroDriftProfiles[category] || heroDriftProfiles.default;
    }

    function fitGlobeTo916() {
        useEarthOrbitBounds();
        if (!state.guide916) {
            state.guide916 = true;
            updateGuide916();
        }
        const fitCamera = camera.clone();
        fitCamera.position.copy(camera.position);
        fitCamera.quaternion.copy(camera.quaternion);
        fitCamera.aspect = 9 / 16;
        applyExportCameraFramingTo(fitCamera, fitCamera.aspect);

        focus.active = true;
        focus.fromPos.copy(camera.position);
        focus.toPos.copy(fitCamera.position);
        focus.fromTarget.copy(controls.target);
        focus.toTarget.copy(controls.target.clone().add(new THREE.Vector3(0, -0.08, 0)));
        focus.start = getTime();
        focus.duration = 1.1;
        controls.autoRotate = false;
    }

    function applyMotionPreset(name) {
        state.motionPreset = motionPresets[name] ? name : 'slowOrbit';
        const preset = motionPresets[state.motionPreset];
        controls.autoRotate = true;
        controls.autoRotateSpeed = preset.autoRotateSpeed;
        controls.dampingFactor = preset.dampingFactor;
        focus.duration = state.brandPreset ? Math.max(preset.focusDuration, 2.05) : preset.focusDuration;
        state.motionOffsetY = 0;
        updateMotionPresetUi?.(state.motionPreset);
    }

    function focusOnLonLat(lon, lat, distance = 4.2) {
        useEarthOrbitBounds();
        const surface = lonLatToVec3(lon, lat, 2.0).normalize();
        const side = new THREE.Vector3(0, 1, 0).cross(surface).normalize();
        if (!Number.isFinite(side.x)) side.set(1, 0, 0);
        const upBias = new THREE.Vector3(0, 0.26, 0);
        const desiredDir = surface.clone().multiplyScalar(distance).add(side.multiplyScalar(0.42)).add(upBias);
        focus.active = true;
        focus.fromPos.copy(camera.position);
        focus.toPos.copy(desiredDir);
        focus.fromTarget.copy(controls.target);
        focus.toTarget.copy(surface.clone().multiplyScalar(0.32));
        focus.start = getTime();
        controls.autoRotate = false;
    }

    function setSelectedCinematic(lon, lat, distance = 3.72) {
        useEarthOrbitBounds();
        const surface = lonLatToVec3(lon, lat, 2.0).normalize();
        const side = new THREE.Vector3(0, 1, 0).cross(surface).normalize();
        if (!Number.isFinite(side.x)) side.set(1, 0, 0);
        selectedCinematic.active = true;
        selectedCinematic.lon = lon;
        selectedCinematic.lat = lat;
        selectedCinematic.distance = distance;
        selectedCinematic.surface.copy(surface);
        selectedCinematic.side.copy(side);
        selectedCinematic.target.copy(surface.clone().multiplyScalar(0.32));
        selectedCinematic.phaseStart = getTime();
        controls.autoRotate = false;
    }

    function clearSelectedCinematic() {
        selectedCinematic.active = false;
        controls.autoRotate = true;
    }

    function updateFocus(t, onComplete) {
        if (!focus.active) return;
        const k = Math.min(1, (t - focus.start) / focus.duration);
        const eased = k * k * (3 - 2 * k);
        camera.position.lerpVectors(focus.fromPos, focus.toPos, eased);
        controls.target.lerpVectors(focus.fromTarget, focus.toTarget, eased);
        if (k >= 1) {
            focus.active = false;
            controls.autoRotate = true;
            onComplete?.();
        }
    }

    function updateControls() {
        if (issCam.active || moonCam.active || returnCam.active || moonMarkerCam.active) return; // update-urile dedicate gestioneaza camera direct
        const inCinematic = !focus.active && state.motionPreset === 'focusPulse' && selectedCinematic.active;
        if (!inCinematic) controls.update();
    }

    function updateDrift(t) {
        if (focus.active) return;
        if (updateIssTracking(t)) return;
        if (updateReturnFromMoon(t)) return;
        if (updateMoonMarkerFocus(t)) return;
        if (updateMoonTracking(t)) return;
        const preset = motionPresets[state.motionPreset];
        if (state.motionPreset === 'focusPulse' && selectedCinematic.active) {
            const phase = t - selectedCinematic.phaseStart;
            const rhythmAmp = THREE.MathUtils.clamp(state.dataRhythmDriftAmp || 1, 0.75, 1.35);
            const pushPull = Math.sin(phase * 0.46) * 0.075 * rhythmAmp;
            const lateral = Math.sin(phase * 0.28) * 0.055 * rhythmAmp;
            const vertical = Math.cos(phase * 0.34) * 0.035 * rhythmAmp;
            const targetDrift = Math.sin(phase * 0.32) * 0.016 * rhythmAmp;
            const desiredTarget = selectedCinematic.target.clone().add(selectedCinematic.surface.clone().multiplyScalar(targetDrift));
            const desiredOffset = selectedCinematic.surface.clone().multiplyScalar(selectedCinematic.distance + pushPull)
                .add(selectedCinematic.side.clone().multiplyScalar(0.42 + lateral))
                .add(selectedCinematic.upBias.clone().add(new THREE.Vector3(0, vertical, 0)));
            const desiredPos = desiredTarget.clone().add(desiredOffset);
            camera.position.lerp(desiredPos, 0.024);
            controls.target.lerp(desiredTarget, 0.04);
            camera.lookAt(controls.target);
        } else if (state.motionPreset === 'heroDrift') {
            const anchor = heroDriftAnchor();
            if (anchor) {
                const profile = heroDriftProfileFor(anchor);
                const phase = t * profile.phaseSpeed;
                const surface = lonLatToVec3(anchor.lon, anchor.lat, 2.0, scratch.surface).normalize();
                const side = scratch.side.set(0, 1, 0).cross(surface).normalize();
                if (!Number.isFinite(side.x)) side.set(1, 0, 0);
                const verticalAxis = scratch.verticalAxis.copy(surface).cross(side).normalize();
                const desiredTarget = scratch.desiredTarget.copy(surface)
                    .multiplyScalar(profile.targetBias + Math.sin(phase * 1.2) * profile.targetPulse)
                    .add(scratch.targetSide.copy(side).multiplyScalar(Math.sin(phase * 0.8) * profile.targetSide));
                const orbitOffset = surface.clone().multiplyScalar(profile.orbitAmp + Math.cos(phase * 0.9) * profile.orbitPulse);
                const sideOffset = side.clone().multiplyScalar(Math.sin(phase) * profile.sideAmp);
                const verticalOffset = verticalAxis.multiplyScalar(Math.cos(phase * 0.6) * profile.verticalAmp);
                camera.position.add(orbitOffset).add(sideOffset).add(verticalOffset);
                const camDist = camera.position.length();
                if (camDist > 9.0 || camDist < controls.minDistance) {
                    camera.position.setLength(THREE.MathUtils.clamp(camDist, controls.minDistance, 9.0));
                }
                controls.target.lerp(desiredTarget, profile.targetLerp);
                camera.lookAt(controls.target);
            } else if (preset.cameraBobAmp > 0) {
                const distance = camera.position.distanceTo(controls.target);
                const bob = Math.sin(t * preset.cameraBobSpeed) * preset.cameraBobAmp * distance;
                camera.position.y += bob;
                camera.lookAt(controls.target);
            }
        } else if (preset.cameraBobAmp > 0) {
            const distance = camera.position.distanceTo(controls.target);
            const bob = Math.sin(t * preset.cameraBobSpeed) * preset.cameraBobAmp * distance;
            camera.position.y += bob;
            camera.lookAt(controls.target);
        }
    }

    return {
        focus,
        selectedCinematic,
        applyMotionPreset,
        fitGlobeTo916,
        focusOnLonLat,
        setSelectedCinematic,
        clearSelectedCinematic,
        startIssTracking,
        stopIssTracking,
        startMoonTracking,
        stopMoonTracking,
        startMoonMarkerFocus,
        stopMoonMarkerFocus,
        startReturnFromMoon,
        updateFocus,
        updateControls,
        updateDrift,
        clusterScreenPresenceScore,
        heroDriftAnchor
    };
}
