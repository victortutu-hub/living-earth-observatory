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
    selectEvent,
    deselectAll,
    exportReelVideo,
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

    function buildTour(events) {
        return editorialSelection(events, 3, {
            eventSortAge,
            eventRecency,
            eventCategory
        }).filter(event => eventLonLat(event));
    }

    function buildBeats(tour, mood, options = {}) {
        const includeIssBeat = Boolean(options.includeIssBeat);
        const introEnd = Math.max(0.16, mood.introEnd);
        const duration = Math.max(1, state.reelDurationSec || demo.duration || 24);
        const pulloutAt = Math.min(0.92, Math.max(0.84, mood.pulloutAt));
        // Moon/Earthshine are not just another event card: the camera needs a
        // readable flight window, a quiet hold on the lit face, then a separate
        // return to Earth. Keeping these as seconds instead of compact
        // percentages prevents short social reels from cutting the Moon beat.
        const moonFlightSec = 4.6;
        const moonHoldSec = 3.0;
        const earthshineAt = Math.max(introEnd + 0.18, pulloutAt - (moonFlightSec + moonHoldSec) / duration);
        const issWindowSec = 5.8;
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
        timedTour.forEach(({ event, moveAt, snap }, index) => {
            beats.push({
                at: Math.max(0.02, moveAt),
                run: () => {
                    if (snap) demo.spinning = false;
                    applyMotionPreset('focusPulse');
                    dataRhythmCamera?.applyEventRhythm?.(event, focus);
                    selectEvent(event.id);
                    updateReelCaption(event, snap, index + 1, timedTour.length);
                    demo.pendingPulseEvent = event;
                }
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
                    updateReelTitleCard('iss', timedTour.length);
                    startIssTracking?.(issState);
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
                startMoonTracking?.(moonSystem.moon, moonSystem.moonState?.sunWorldDir);
                updateReelTitleCard('earthshine', timedTour.length);
            }
        });
        beats.push({
            at: pulloutAt,
            run: () => {
                updateReelTitleCard('outro', timedTour.length);
                stopIssTracking?.();
                updateIssLayerUi?.({ enabled: state.issLayer, tracking: false });
                deselectAll();
                // Zbor de intoarcere explicit spre Pamant (nu doar stop+heroDrift) -
                // simetric cu plecarea spre Luna, evita salturile brusce de camera
                // pe care heroDrift le facea cand prelua controlul direct de langa Luna.
                startReturnFromMoon?.();
            }
        });
        beats.push({ at: 0.995, run: () => hideReelCaption() });
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

    async function start(events) {
        if (demo.active || state.reelRecording) return;
        const previous = {
            duration: state.reelDurationSec,
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
        const includeIssBeat = state.socialPreset === 'orbitalStory' && state.includeIssBeat !== false;
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
        updateReelDurationUi();
        applyReelMood(directorModeActive ? state.reelMood : 'cinematic');
        applyMotionPreset(directorModeActive ? state.motionPreset : 'slowOrbit');
        applyEarthLook(directorModeActive ? state.earthLook : 'showcase');
        applyAtmosphereMode(directorModeActive ? state.atmosphereMode : 'physical');
        applyBrandPreset(directorModeActive ? state.brandPreset : true);

        const mood = currentReelMood();
        const tourEvents = buildTour(events);
        const timeline = buildBeats(tourEvents, mood, { includeIssBeat });
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
            await exportReelVideo();
        } finally {
            demo.active = false;
            demo.spinning = false;
            demo.pendingPulseEvent = null;
            hideReelCaption();
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

    return {
        start,
        update,
        onFocusComplete,
        isActive: () => demo.active
    };
}
