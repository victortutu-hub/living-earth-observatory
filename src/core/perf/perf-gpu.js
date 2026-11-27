// LOT 28 (moved from src/himalaya/perf/perf-run.js, unchanged): GPU timers of the performance runs.
//   createFrameProbe(gl): renderer.info after each render, GPU TIME_ELAPSED per frame with
//     EXT_disjoint_timer_query_webgl2 when the browser exposes it (disjoint samples dropped).
//   measureToggleGpuCost(...): GPU cost of one part of the scene (e.g. the sky), from renders with
//     and without it, median of `samples` pairs (Living Himalaya and Living Earth).
// No network, no DOM (LOT 45: the page state comes from the caller).

/**
 * Frame probe: renderer.info after each render; GPU TIME_ELAPSED per frame when available.
 * LOT 45 (optional, Living Earth): `pageState()` -> { visible, focused } is read when a sample is taken; a sample
 * from a hidden or unfocused page is left out and counted (excludedHiddenSamples). Without pageState nothing is
 * left out (Living Himalaya: unchanged). No second timer inside the frame: an extra query pair before the render
 * moved the render timer up by ~1.5 ms (LOT 45); the field layers are timed by measureControlledRender instead.
 */
export function createFrameProbe(gl, { pageState = null } = {}) {
  const ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') || null;
  const fresh = () => ({ gpuMs: [], disjoint: 0, excludedHidden: 0, calls: [], triangles: [] });
  const state = { recording: false, active: null, pending: [], ...fresh() };
  const pageOk = () => { if (!pageState) return true; const p = pageState(); return Boolean(p?.visible && p?.focused); };
  return {
    gpuAvailable: Boolean(ext),
    start() { Object.assign(state, { recording: true, ...fresh() }); },
    stop() { state.recording = false; },
    before() {
      if (!state.recording || !ext || state.active) return;
      state.active = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, state.active);
    },
    after(renderer) {
      if (state.active) { gl.endQuery(ext.TIME_ELAPSED_EXT); state.pending.push({ query: state.active, pageOk: pageOk() }); state.active = null; }
      if (state.recording) { state.calls.push(renderer.info.render.calls); state.triangles.push(renderer.info.render.triangles); }
    },
    poll() {
      if (!ext) return;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (state.pending.length && gl.getQueryParameter(state.pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
        const { query, pageOk: ok } = state.pending.shift();
        if (disjoint) state.disjoint += 1;
        else if (!ok) state.excludedHidden += 1;
        else state.gpuMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
    },
    pendingCount: () => state.pending.length,
    results: () => ({ gpuMs: [...state.gpuMs], disjoint: state.disjoint, excludedHiddenSamples: state.excludedHidden, calls: [...state.calls], triangles: [...state.triangles] }),
    dispose() { state.recording = false; if (ext) for (const p of state.pending) gl.deleteQuery(p.query); state.pending = []; },
  };
}

/**
 * LOT 45: GPU time of one call of `renderOnce` (a render, or the field layers' update), from `samples` back-to-back
 * calls outside the frame loop (the method of the sky cost), the first `drop` left out (warm-up). Independent of the
 * phase against the display. Returns
 * { available, disjoint, samples, p50Ms, p90Ms } (null figures with no samples).
 */
export async function measureControlledRender({ gl, renderOnce, samples = 16, drop = 1, timeoutMs = 3000, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2');
  if (!ext) return { available: false };
  const pending = [];
  for (let i = 0; i < samples; i++) {
    const query = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    renderOnce();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    pending.push(query);
  }
  const started = performance.now();
  while (pending.some((q) => !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) && performance.now() - started < timeoutMs) await wait(16);
  const disjoint = Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));
  const values = [];
  pending.forEach((q, i) => { if (i >= drop && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) values.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); });
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))].toFixed(3) : null);
  return { available: true, disjoint, samples: values.length, dropped: drop, p50Ms: pick(50), p90Ms: pick(90) };
}

export function median(values) { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; }

/**
 * GPU cost of a part of the scene: `samples` renders with it and without it, timed with
 * TIME_ELAPSED; `setOn(boolean)` shows / hides the part, `renderOnce()` renders one frame, `restore()`
 * puts the part back. Returns { available, disjoint, samples, withGpuMs, withoutGpuMs, costGpuMs }.
 */
export async function measureToggleGpuCost({ gl, renderOnce, setOn, restore, samples = 8, timeoutMs = 3000, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2');
  if (!ext) return { available: false };
  const runOne = (withPart) => {
    setOn(withPart);
    const query = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    renderOnce();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    return query;
  };
  const pending = [];
  for (let i = 0; i < samples; i++) { pending.push(['with', runOne(true)]); pending.push(['without', runOne(false)]); }
  restore();
  const started = performance.now();
  while (pending.some(([, q]) => !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) && performance.now() - started < timeoutMs) await wait(16);
  const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
  const results = { with: [], without: [] };
  for (const [kind, q] of pending) {
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) results[kind].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
  }
  const withMs = median(results.with); const withoutMs = median(results.without);
  return {
    available: true, disjoint, samples: results.with.length,
    withGpuMs: withMs != null ? +withMs.toFixed(3) : null, withoutGpuMs: withoutMs != null ? +withoutMs.toFixed(3) : null,
    costGpuMs: withMs != null && withoutMs != null ? +(withMs - withoutMs).toFixed(3) : null,
  };
}
