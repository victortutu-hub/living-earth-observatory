// LOT 28 (UI of src/himalaya/perf/perf-run.js, moved and parameterised, behaviour unchanged): the
// performance panel shared by Living Himalaya and Living Earth. Manual start (banner + Start),
// progress list, results table, Copy JSON / Download JSON (Blob URL). Nothing is sent anywhere.
import { HEADLESS_NOTE } from './perf-harness.js';

export const PERF_BANNER = 'Performance run — keep this tab visible; do not touch the page.';

const STYLE = `
.lumi-perf { position: fixed; z-index: 50; top: 12px; left: 50%; transform: translateX(-50%); width: min(760px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; box-sizing: border-box;
  background: rgba(6, 12, 22, 0.94); border: 1px solid rgba(253, 230, 138, 0.5); color: #eef8ff; font: 12px/1.45 Inter, system-ui, sans-serif; padding: 12px 14px; }
.lumi-perf h2 { margin: 0 0 6px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #fde68a; }
.lumi-perf p { margin: 4px 0; }
.lumi-perf button { border: 1px solid rgba(103, 232, 249, 0.4); background: rgba(4, 9, 17, 0.8); color: #eef8ff; font: inherit; padding: 5px 10px; margin: 6px 6px 0 0; cursor: pointer; }
.lumi-perf button:disabled { opacity: 0.5; cursor: default; }
.lumi-perf ol { margin: 6px 0; padding-left: 18px; }
.lumi-perf .is-invalid { color: #fca5a5; }
.lumi-perf .lumi-perf-table { overflow-x: auto; max-width: 100%; }
.lumi-perf table { border-collapse: collapse; font-size: 11px; white-space: nowrap; }
.lumi-perf th, .lumi-perf td { border-bottom: 1px solid rgba(155, 176, 196, 0.25); padding: 3px 6px; text-align: right; }
.lumi-perf th:first-child, .lumi-perf td:first-child { text-align: left; }
.lumi-perf textarea { width: 100%; box-sizing: border-box; height: 140px; background: #02050b; color: #c4d4e2; border: 1px solid rgba(155, 176, 196, 0.3); font: 11px/1.35 ui-monospace, monospace; }
.lumi-perf .lumi-perf-warning { color: #fde68a; }
`;

export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));

/** Results table; `customRow(s, row)` may fill the row of a non-frames scenario and return true. */
export function resultsTable(report, customRow = () => false) {
  const table = el('table');
  const head = el('tr');
  ['Scenario', 'Valid', 'FPS', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', '>33 ms', 'GPU p50 ms', 'Sky GPU ms', 'Draws', 'Triangles'].forEach((h) => head.append(el('th', null, h)));
  table.append(head);
  for (const s of report.scenarios) {
    const row = el('tr', s.valid ? null : 'is-invalid');
    if (!customRow(s, row)) {
      const f = s.frames || {};
      [s.id, s.valid ? 'yes' : `no — ${s.reason}`, fmt(f.meanFps), fmt(f.p50Ms), fmt(f.p95Ms), fmt(f.p99Ms), fmt(f.maxMs), f.over33Ms ?? '—', s.gpu ? fmt(s.gpu.p50Ms, 2) : (s.valid ? 'n/a' : '—'), fmt(s.skyGpuMs, 2), s.drawCalls ?? '—', s.triangles ?? '—']
        .forEach((v) => row.append(el('td', null, String(v))));
    }
    table.append(row);
  }
  const wrap = el('div', 'lumi-perf-table');
  wrap.append(table);
  return wrap;
}

/**
 * Mounts the panel. createRunner(onProgress) -> { run(): Promise<report>, dispose() };
 * extraNotes(report) -> string[] (e.g. the layout checks). Returns the teardown function.
 */
export function mountPerfPanel({ schema, scenarios, timing, createRunner, filePrefix, intro: introText, customRow, extraNotes = () => [] }) {
  const style = el('style'); style.id = 'lumi-perf-style'; style.textContent = STYLE;
  document.head.append(style);
  const panel = el('section', 'lumi-perf');
  panel.setAttribute('aria-label', 'Performance run');
  panel.dataset.perfState = 'idle';
  const title = el('h2', null, `Performance run (${schema})`);
  const banner = el('p', 'lumi-perf-warning', PERF_BANNER);
  const intro = el('p', null, introText || `${scenarios.length} fixed scenarios, each ${timing.warmupMs / 1000} s warm-up + ${timing.measureMs / 1000} s measurement. Results stay on this page; nothing is sent.`);
  const start = el('button', null, 'Start');
  const close = el('button', null, 'Close');
  const progress = el('ol');
  const results = el('div');
  panel.append(title, banner, intro, start, close, progress, results);
  document.body.append(panel);
  let runner = null;
  let objectUrl = null;

  start.addEventListener('click', async () => {
    start.disabled = true;
    panel.dataset.perfState = 'running';
    intro.hidden = true;
    progress.replaceChildren(...scenarios.map((s) => Object.assign(el('li', null, `${s.id}. ${s.label} — waiting`), { id: `lumi-perf-${s.id}` })));
    results.replaceChildren();
    runner?.dispose();
    runner = createRunner(({ id, label, state, reason }) => {
      const item = progress.querySelector(`#lumi-perf-${id}`);
      if (!item) return;
      item.textContent = `${id}. ${label} — ${state}${reason ? ` (${reason})` : ''}`;
      item.className = state === 'invalid' ? 'is-invalid' : '';
    });
    const report = await runner.run();
    window.__lumiPerfReport = report;
    panel.dataset.perfState = 'done';
    const json = JSON.stringify(report, null, 1);
    const text = el('textarea'); text.readOnly = true; text.value = json; text.setAttribute('aria-label', 'Performance report (JSON)');
    const copy = el('button', null, 'Copy JSON');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(json); copy.textContent = 'Copied'; } catch { text.select(); document.execCommand?.('copy'); copy.textContent = 'Selected — copy with Ctrl+C'; }
    });
    const download = el('button', null, 'Download JSON');
    download.addEventListener('click', () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = el('a'); a.href = objectUrl; a.download = `${filePrefix}-${report.createdAt.replace(/[:.]/g, '-')}.json`;
      document.body.append(a); a.click(); a.remove();
    });
    const notes = [
      report.environment.headless ? `Note: ${HEADLESS_NOTE}.` : null,
      ...report.scenarios.filter((s) => s.vsync?.likely).map((s) => `${s.id}: ${s.vsync.note}.`),
      ...extraNotes(report),
      report.validation.length ? `Schema problems: ${report.validation.join('; ')}` : `Report valid (schema ${schema}).`,
    ].filter(Boolean);
    results.replaceChildren(resultsTable(report, customRow), ...notes.map((n) => el('p', null, n)), copy, download, text);
    start.disabled = false;
    start.textContent = 'Run again';
  });
  close.addEventListener('click', () => teardown());

  function teardown() {
    runner?.dispose();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    panel.remove();
    style.remove();
  }
  return teardown;
}
