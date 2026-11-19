// LOT 19 (moved to src/core/perf/ in LOT 28, unchanged): statistics for the performance runs
// (Living Himalaya, Living Earth) - pure functions, no DOM.
// Percentiles use the nearest-rank method on the sorted samples (p in (0, 100]).

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const round = (v, d = 3) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d));

/** Summary of a list of durations in ms. */
export function summarize(samplesMs) {
  const values = samplesMs.filter((v) => Number.isFinite(v) && v >= 0);
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((s, v) => s + v, 0);
  return {
    count: values.length, meanMs: round(total / values.length), p50Ms: round(percentile(sorted, 50)), p95Ms: round(percentile(sorted, 95)),
    p99Ms: round(percentile(sorted, 99)), maxMs: round(sorted.at(-1)),
  };
}

/** Frame-interval statistics from requestAnimationFrame deltas (ms). */
export function frameStats(deltasMs) {
  const s = summarize(deltasMs);
  if (!s) return null;
  const total = deltasMs.reduce((a, v) => a + v, 0);
  return { ...s, over33Ms: deltasMs.filter((v) => v > 33.4).length, meanFps: round((1000 * s.count) / total, 1) };
}

const REFRESH_HZ = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];

/**
 * Is the frame rate set by the display refresh rather than by rendering? Likely when the median
 * frame interval sits within 5 % of a refresh interval and (if known) the GPU median is well below it.
 */
export function vsyncAssessment(frameP50Ms, gpuP50Ms = null) {
  if (!Number.isFinite(frameP50Ms)) return { likely: false, refreshHz: null, note: 'no frames' };
  const match = REFRESH_HZ.map((hz) => ({ hz, interval: 1000 / hz })).find(({ interval }) => Math.abs(frameP50Ms - interval) / interval < 0.05);
  if (!match) return { likely: false, refreshHz: null, note: 'median frame interval does not match a display refresh rate: rendering- or CPU-bound' };
  const gpuHeadroom = Number.isFinite(gpuP50Ms) ? gpuP50Ms < 0.8 * match.interval : null;
  if (gpuHeadroom === false) return { likely: false, refreshHz: match.hz, note: `median ≈ ${match.interval.toFixed(1)} ms (${match.hz} Hz) but the GPU time is close to it: possibly GPU-bound` };
  return {
    likely: true, refreshHz: match.hz,
    note: `vsync-limited: median ≈ ${match.interval.toFixed(1)} ms (${match.hz} Hz); frame times show the display refresh, not the rendering cost${gpuHeadroom ? ' (GPU time well below the interval)' : ''}`,
  };
}
