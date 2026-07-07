function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}

function clusterForEvent(state, event) {
    if (!event?.id) return null;
    return state.clusters.find(cluster =>
        cluster.primary?.id === event.id ||
        cluster.events?.some(item => item.id === event.id)
    ) || null;
}

export function createDataRhythmCamera({
    state,
    eventRecency,
    eventMagnitudeScale
}) {
    function eventRhythm(event) {
        if (!state.dataRhythm || !event) {
            return {
                importance: 0,
                focusDuration: 3.45,
                pulseAmp: 1,
                driftAmp: 1
            };
        }

        const cluster = clusterForEvent(state, event);
        const recency = clamp01(eventRecency(event));
        const magnitude = clamp01((eventMagnitudeScale(event) - 1) / 0.9);
        const clusterWeight = clamp01(Math.log2((cluster?.count || 1) + 1) / 4);
        const importance = clamp01(recency * 0.46 + magnitude * 0.34 + clusterWeight * 0.2);

        return {
            importance,
            focusDuration: 3.05 + importance * 1.15,
            pulseAmp: 0.88 + importance * 0.5,
            driftAmp: 0.82 + importance * 0.42
        };
    }

    function applyEventRhythm(event, focus) {
        const rhythm = eventRhythm(event);
        state.dataRhythmPulseAmp = rhythm.pulseAmp;
        state.dataRhythmDriftAmp = rhythm.driftAmp;
        if (focus) focus.duration = rhythm.focusDuration;
        return rhythm;
    }

    function reset() {
        state.dataRhythmPulseAmp = 1;
        state.dataRhythmDriftAmp = 1;
    }

    return {
        eventRhythm,
        applyEventRhythm,
        reset
    };
}
