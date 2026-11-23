// LOT 19 (moved to src/core/perf/ in LOT 28, unchanged): statistics for the performance runs
// (Living Himalaya, Living Earth) - pure functions, no DOM. LOT 32: vsync-wait samples of the GPU timer.
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

// LOT 32: a GPU TIME_ELAPSED sample can span the wait for the display. On the GTX 1650 (Edge / Chrome 158),
// 5 to 18 % of the samples in some scenarios were about 16.3 ms at 60 Hz, with an unchanged SM clock.
// Those samples measure vsync, not GPU work, and they lifted the mean, not the p50. A sample >= 0.9 × the
// detected refresh interval counts as a vsync wait. meanExclVsyncMs is the mean without these samples. p50
// stays the headline value.
export const VSYNC_WAIT_FRACTION = 0.9;

/**
 * Vsync-wait samples of a GPU timer series (ms). Returns { vsyncWaitSamples, meanExclVsyncMs, thresholdMs };
 * both values are null when no refresh rate is known. Returns null for no samples.
 */
export function vsyncWaitStats(samplesMs, refreshHz) {
  const values = samplesMs.filter((v) => Number.isFinite(v) && v >= 0);
  if (!values.length) return null;
  if (!Number.isFinite(refreshHz) || refreshHz <= 0) return { vsyncWaitSamples: null, meanExclVsyncMs: null, thresholdMs: null };
  const threshold = (VSYNC_WAIT_FRACTION * 1000) / refreshHz;
  const kept = values.filter((v) => v < threshold);
  return {
    vsyncWaitSamples: values.length - kept.length,
    meanExclVsyncMs: kept.length ? round(kept.reduce((s, v) => s + v, 0) / kept.length) : null,
    thresholdMs: round(threshold),
  };
}

/** LOT 32: the note that goes with the two fields above. */
export function vsyncWaitNote(stats, refreshHz) {
  if (!stats || stats.vsyncWaitSamples === null) return 'vsync-wait samples not separated: no display refresh rate detected (p50 is the headline value)';
  return `${stats.vsyncWaitSamples} GPU timer samples >= ${stats.thresholdMs} ms (0.9 × the ${refreshHz} Hz interval) counted as vsync waits: the timer then spans the wait for the display, not GPU work; meanExclVsyncMs leaves them out; p50 is the headline value`;
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
