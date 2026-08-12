export function editorialSelection(events, limit = 3, helpers = {}) {
    const {
        eventSortAge,
        eventRecency,
        eventCategory
    } = helpers;
    const sorted = [...events].sort((a, b) => {
        const diff = eventSortAge(a) - eventSortAge(b);
        if (diff !== 0) return diff;
        return eventRecency(b) - eventRecency(a);
    });
    const picks = [];
    const usedCategories = new Set();
    for (const event of sorted) {
        const category = eventCategory(event);
        if (!usedCategories.has(category)) {
            picks.push(event);
            usedCategories.add(category);
        }
        if (picks.length >= limit) return picks;
    }
    for (const event of sorted) {
        if (!picks.includes(event)) picks.push(event);
        if (picks.length >= limit) break;
    }
    return picks;
}

export function createDemoReelTimeline({
    state,
    controls,
    focus,
    getTime,
    currentReelMood,
    eventLonLat,
    eventCategory,
    eventSortAge,
    eventRecency,
    eventMagnitudeScale,
    dataRhythmCamera,
    updateReelDurationUi,
    updateSpinUi,
    updateCaptureMode,
    applyNightLook,
    applyMotionPreset,
    applyEarthLook,
    applyAtmosphereMode,
    applyReelMood,
    applyBrandPreset,
    updateReelTitleCard,
    updateReelTransitionCard,
    updateReelCaption,
    updateReelDetailsCard,
    hideReelCaption,
    showReelCodeSnippet,
    hideReelCodeSnippet,
    selectEvent,
    deselectAll,
    exportReelVideo,
    exportReelVideoH264,
    triggerSignalPulse,
    moonSystem,
    issSystem,
    updateIssLayerUi,
    startIssTracking,
    stopIssTracking,
    startMoonTracking,
    stopMoonTracking,
    startReturnFromMoon
}) {
    const demo = {
        active: false,
        start: 0,
        duration: 16,
        beats: [],
        nextBeat: 0,
        spinning: false,
        introEnd: 0.12,
        spinFrom: 0.4,
        spinTo: 6.0,
        pendingPulseEvent: null
    };

    function buildTour(events, count = 3) {
        return editorialSelection(events, count, {
            eventSortAge,
            eventRecency,
            eventCategory
        }).filter(event => eventLonLat(event));
    }

    function buildBeats(tour, mood, options = {}) {
        const includeIssBeat = Boolean(options.includeIssBeat);
        const localCinematic = Boolean(options.localCinematic);
        const introEnd = Math.max(localCinematic ? 0.22 : 0.16, mood.introEnd);
        const duration = Math.max(1, state.reelDurationSec || demo.duration || 24);
        // Rezervam finalul pentru zborul complet inapoi la Pamant; la 58 s
        // revenirea incepea prea tarziu si exportul se termina in mijlocul ei.
        const pulloutAt = Math.min(localCinematic ? 0.90 : 0.92, Math.max(0.84, mood.pulloutAt));
        // Moon/Earthshine are not just another event card: the camera needs a
        // readable flight window, a quiet hold on the lit face, then a separate
        // return to Earth. Keeping these as seconds instead of compact
        // percentages prevents short social reels from cutting the Moon beat.
        const moonFlightSec = localCinematic ? 6.2 : 6.6;
        const moonHoldSec = localCinematic ? 9.0 : 7.4;
        const earthshineAt = Math.max(introEnd + 0.18, pulloutAt - (moonFlightSec + moonHoldSec) / duration);
        const issWindowSec = localCinematic ? 8.5 : 7.0;
        const issAt = includeIssBeat
            ? Math.max(introEnd + 0.2, earthshineAt - issWindowSec / duration)
            : null;
        const eventWindowEnd = Math.max(introEnd + 0.18, (issAt ?? earthshineAt) - 0.08);
        const slot = tour.length ? (eventWindowEnd - introEnd) / tour.length : 0;
        const timedTour = tour.map((event, i) => {
            const moveAt = introEnd + i * slot + slot * 0.04;
            return { event, moveAt, snap: i === 0 };
        });
        const beats = [
            {
                at: 0.00,
                run: () => {
                    updateReelTitleCard('intro', timedTour.length);
                    if (localCinematic) showReelCodeSnippet?.('bootstrap');
                    applyMotionPreset('slowOrbit');
                    controls.autoRotate = true;
                    demo.spinning = true;
                }
            }
        ];
        if (!timedTour.length) {
            beats.push({
                at: 0.18,
                run: () => {
                    demo.spinning = false;
                    applyMotionPreset('heroDrift');
                }
            });
        }
        // Cardul evenimentului apare cand camera AJUNGE la marker, nu cand pleaca:
        // intarziem caption-ul cu ~timpul de zbor al focus-ului, ca sa fie sincron.
        const captionDelay = Math.min(slot * (localCinematic ? 0.56 : 0.45), (localCinematic ? 2.6 : 2.0) / duration);
        timedTour.forEach(({ event, moveAt, snap }, index) => {
            beats.push({
                at: Math.max(0.02, moveAt),
                run: () => {
                    if (snap) demo.spinning = false;
                    if (localCinematic) showReelCodeSnippet?.('event');
                    applyMotionPreset('focusPulse');
                    dataRhythmCamera?.applyEventRhythm?.(event, focus);
                    selectEvent(event.id);
                    demo.pendingPulseEvent = event;
                }
            });
            beats.push({
                at: Math.max(0.02, moveAt + captionDelay),
                run: () => updateReelCaption(event, snap, index + 1, timedTour.length)
            });
        });
        if (includeIssBeat && issAt !== null) {
            beats.push({
                at: issAt,
                run: () => {
                    const issState = issSystem?.issState;
                    if (!issState?.visible) return;
                    demo.spinning = false;
                    deselectAll();
                    if (localCinematic) showReelCodeSnippet?.('iss');
                    updateReelTitleCard('iss', timedTour.length);
                    startIssTracking?.(issState, localCinematic
                        ? {
                            cinematicOrbitAngle: 0.52,
                            cinematicOrbitDelay: 0.7,
                            cinematicOrbitDuration: issWindowSec - 0.7
                        }
                        : undefined);
                    updateIssLayerUi?.({ enabled: true, tracking: true });
                }
            });
        }
        beats.push({
            at: earthshineAt,
            run: () => {
                if (!moonSystem?.moon || !moonSystem?.moonState?.visible) return;
                demo.spinning = false;
                stopIssTracking?.();
                updateIssLayerUi?.({ enabled: state.issLayer, tracking: false });
                deselectAll();
                moonSystem.setEarthshineBoost?.(1.28);
                if (localCinematic) showReelCodeSnippet?.('moon');
                startMoonTracking?.(moonSystem.moon, moonSystem.moonState?.sunWorldDir, localCinematic
                    ? { duration: moonFlightSec, distance: 0.62, targetLeadMultiplier: 1.0 }
                    : undefined);
                updateReelTitleCard('earthshine', timedTour.length);
            }
        });
        beats.push({
            at: pulloutAt,
            run: () => {
                if (localCinematic) showReelCodeSnippet?.('outro');
                stopIssTracking?.();
                updateIssLayerUi?.({ enabled: state.issLayer, tracking: false });
                deselectAll();
                // Zbor de intoarcere explicit spre Pamant (nu doar stop+heroDrift) -
                // simetric cu plecarea spre Luna, evita salturile brusce de camera
                // pe care heroDrift le facea cand prelua controlul direct de langa Luna.
                startReturnFromMoon?.(6.4, localCinematic
                    ? { duration: 5.5, heroView: true, lon: 25, lat: 8, holdFinalOrientation: true }
                    : undefined);
            }
        });
        // Cardul outro ("Earth Observatory - Live Window") apare doar dupa ce Terra
        // a reintrat efectiv in cadru, nu pe ecranul negru din timpul returului.
        beats.push({
            at: Math.min(0.985, pulloutAt + 2.8 / duration),
            run: () => updateReelTitleCard('outro', timedTour.length)
        });
        beats.push({ at: 0.995, run: () => { hideReelCaption(); hideReelCodeSnippet?.(); } });
        return { beats: beats.sort((a, b) => a.at - b.at), tour: timedTour, introEnd, pulloutAt };
    }

    function logTimeline(tour) {
        console.log('%c[Demo reel] guided tour timeline:', 'color:#ffb347;font-weight:bold');
        tour.forEach(({ event, moveAt, snap }) => {
            const moveSec = (moveAt * state.reelDurationSec).toFixed(1);
            const ll = eventLonLat(event);
            console.log(`  ${moveSec}s  ${snap ? '[SNAP] ' : ''}${event.title}  [${eventCategory(event)}]  ${ll.lat.toFixed(1)}, ${ll.lon.toFixed(1)}`);
        });
    }

    // opts: { codec: 'webm' | 'h264', aspect: '9:16' | '16:9', durationSec }
    // Fara opts pastreaza comportamentul clasic al Demo reel-ului (WebM, aspectul
    // curent, durata calculata mai jos).
    async function start(events, opts = {}) {
        if (demo.active || state.reelRecording) return;
        const previous = {
            duration: state.reelDurationSec,
            aspect: state.reelAspect,
            brand: state.brandPreset,
            motion: state.motionPreset,
            earthLook: state.earthLook,
            atmosphere: state.atmosphereMode,
            reelMood: state.reelMood,
            spinFast: state.spinFast,
            snapDuration: state.snapDuration,
            night: state.night,
            captureMode: state.captureMode,
            issLayer: state.issLayer
        };
        dataRhythmCamera?.reset?.();
        const directorModeActive = state.socialPreset && state.socialPreset !== 'custom';
        const includeIssBeat = opts.includeIss || (state.socialPreset === 'orbitalStory' && state.includeIssBeat !== false);
        if (includeIssBeat && !state.issLayer) {
            state.issLayer = true;
            updateIssLayerUi?.({ enabled: true });
            await issSystem?.setEnabled?.(true);
        }
        // Marit de la 18/24 la 24/34: fereastra alocata fiecarui eveniment
        // (calculata proportional in buildBeats) era prea ingusta pentru ca
        // privitorul sa apuce sa citeasca titlul/caption-ul inainte de tranzitia
        // spre urmatorul eveniment.
        state.reelDurationSec = directorModeActive
            ? Math.max(30, state.reelDurationSec || 34)
            : 34;
        if (opts.durationSec) state.reelDurationSec = opts.durationSec;
        updateReelDurationUi();
        if (opts.aspect) state.reelAspect = opts.aspect;
        applyReelMood(directorModeActive ? state.reelMood : 'cinematic');
        applyMotionPreset(directorModeActive ? state.motionPreset : 'slowOrbit');
        applyEarthLook(directorModeActive ? state.earthLook : 'showcase');
        applyAtmosphereMode(directorModeActive ? state.atmosphereMode : 'physical');
        applyBrandPreset(directorModeActive ? state.brandPreset : true);

        const mood = currentReelMood();
        const tourEvents = buildTour(events, opts.eventCount);
        if (opts.localCinematic) applyNightLook(true);
        const timeline = buildBeats(tourEvents, mood, { includeIssBeat, localCinematic: opts.localCinematic });
        demo.introEnd = timeline.introEnd;
        demo.spinFrom = 0.4;
        demo.spinTo = state.spinFast;
        demo.beats = timeline.beats;
        demo.nextBeat = 0;
        demo.duration = state.reelDurationSec;
        demo.start = getTime();
        demo.active = true;
        logTimeline(timeline.tour);

        try {
            await (opts.codec === 'h264' && exportReelVideoH264 ? exportReelVideoH264() : exportReelVideo());
        } finally {
            demo.active = false;
            demo.spinning = false;
            demo.pendingPulseEvent = null;
            hideReelCaption();
            hideReelCodeSnippet?.();
            deselectAll();
            stopIssTracking?.();
            if (includeIssBeat && !previous.issLayer && state.issLayer) {
                state.issLayer = false;
                await issSystem?.setEnabled?.(false);
            }
            updateIssLayerUi?.({ enabled: state.issLayer, tracking: false });
            stopMoonTracking?.();
            startReturnFromMoon?.(6.4);
            moonSystem?.setEarthshineBoost?.(1);
            applyReelMood(previous.reelMood);
            applyEarthLook(previous.earthLook);
            applyAtmosphereMode(previous.atmosphere);
            applyBrandPreset(previous.brand);
            applyNightLook(previous.night);
            applyMotionPreset(previous.motion);
            state.captureMode = previous.captureMode;
            updateCaptureMode();
            state.spinFast = previous.spinFast;
            state.snapDuration = previous.snapDuration;
            state.reelDurationSec = previous.duration;
            state.reelAspect = previous.aspect;
            dataRhythmCamera?.reset?.();
            updateSpinUi?.();
            updateReelDurationUi();
        }
    }

    function update(t) {
        if (!demo.active) return;
        const progress = (t - demo.start) / demo.duration;
        while (demo.nextBeat < demo.beats.length && progress >= demo.beats[demo.nextBeat].at) {
            demo.beats[demo.nextBeat].run();
            demo.nextBeat++;
        }
        if (demo.spinning) {
            const spinProgress = Math.min(1, Math.max(0, progress / demo.introEnd));
            const ease = spinProgress * spinProgress;
            controls.autoRotateSpeed = demo.spinFrom + (demo.spinTo - demo.spinFrom) * ease;
        }
    }
    function onFocusComplete() {
        if (demo.active && demo.pendingPulseEvent) {
            triggerSignalPulse(demo.pendingPulseEvent);
            demo.pendingPulseEvent = null;
        }
    }

    function dispose() {
        demo.active = false;
        demo.spinning = false;
        demo.pendingPulseEvent = null;
        demo.beats = [];
        hideReelCaption();
        stopIssTracking?.();
        stopMoonTracking?.();
        moonSystem?.setEarthshineBoost?.(1);
    }

    return {
        start,
        update,
        onFocusComplete,
        dispose,
        isActive: () => demo.active
    };
}
