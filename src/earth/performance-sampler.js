const DEFAULT_WINDOW_MS = 10_000;
const MAX_FRAME_GAP_MS = 1_000;

function round(value, precision = 1) {
    if (!Number.isFinite(value)) return null;
    const scale = 10 ** precision;
    return Math.round(value * scale) / scale;
}

function percentile(sortedValues, fraction) {
    if (!sortedValues.length) return null;
    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(fraction * sortedValues.length) - 1));
    return sortedValues[index];
}

// Measures requestAnimationFrame cadence only. It intentionally does not claim GPU frame time.
export function createFramePerformanceSampler({ windowMs = DEFAULT_WINDOW_MS } = {}) {
    const samples = [];
    let previousTimestamp = null;

    function prune(timestamp) {
        const cutoff = timestamp - windowMs;
        while (samples.length && samples[0].timestamp < cutoff) samples.shift();
    }

    function record(timestamp) {
        if (!Number.isFinite(timestamp)) return;
        if (previousTimestamp !== null) {
            const deltaMs = timestamp - previousTimestamp;
            if (deltaMs > 0 && deltaMs <= MAX_FRAME_GAP_MS) samples.push({ timestamp, deltaMs });
        }
        previousTimestamp = timestamp;
        prune(timestamp);
    }

    function snapshot(timestamp = previousTimestamp) {
        if (!Number.isFinite(timestamp) || !samples.length) {
            return Object.freeze({ windowMs, sampleDurationMs: 0, frames: 0, averageFps: null, medianFps: null, onePercentLowFps: null, averageFrameMs: null, p99FrameMs: null });
        }

        prune(timestamp);
        const deltas = samples.map(sample => sample.deltaMs);
        const totalMs = deltas.reduce((sum, value) => sum + value, 0);
        const ordered = [...deltas].sort((a, b) => a - b);
        const averageFrameMs = totalMs / deltas.length;
        const medianFrameMs = percentile(ordered, 0.5);
        const p99FrameMs = percentile(ordered, 0.99);

        return Object.freeze({
            windowMs,
            sampleDurationMs: round(totalMs),
            frames: deltas.length,
            averageFps: round(1000 / averageFrameMs),
            medianFps: round(1000 / medianFrameMs),
            onePercentLowFps: round(1000 / p99FrameMs),
            averageFrameMs: round(averageFrameMs, 2),
            p99FrameMs: round(p99FrameMs, 2)
        });
    }

    function reset() {
        samples.length = 0;
        previousTimestamp = null;
    }

    return Object.freeze({ record, snapshot, reset });
}
