// Living Himalaya LOT 1: peak list, peak panel, permanent provenance bar and
// the terrain-less scene. Started and destroyed by the module host
// (living-himalaya-module.js); after destroy nothing restarts (async work
// checks the signal).
import { HIMALAYA_PEAKS, HIMALAYA_REGION_CENTER, getHimalayaPeak } from '../config/himalaya-peaks.js';

export const PROVENANCE_BAR_TEXT = 'Peaks: reference list (sources cited) | Terrain: not loaded (next lot)';
export const FUTURE_FIELDS = Object.freeze(['Terrain', 'Weather', 'Image', 'History']);

/** Initial focus from ?focus=<peak id>; anything else -> null (overview). */
export function resolveInitialFocus(search) {
  const value = new URLSearchParams(search || '').get('focus');
  return value && getHimalayaPeak(value) ? value : null;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatElevation(value) {
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })} m`;
}

function renderPanel(panel, peak) {
  if (!peak) {
    panel.replaceChildren(
      element('h2', null, '14 summits above 8000 m'),
      element('p', 'himalaya-panel-hint', 'Choose a summit from the list or click a marker.'),
    );
    return;
  }
  const rows = element('dl', 'himalaya-panel-rows');
  const add = (label, value, state = '') => {
    const term = element('dt', null, label);
    const detail = element('dd', state ? `is-${state}` : null, value);
    rows.append(term, detail);
  };
  add('Range', peak.range);
  add('Elevation', `${formatElevation(peak.elevationM)} — ${peak.elevationSource}`);
  if (peak.alternateElevations.length) {
    add('Other published', peak.alternateElevations.map((entry) => `${formatElevation(entry.elevationM)} (${entry.source})`).join('; '));
  }
  add('Summit', `${peak.lat.toFixed(4)}° N, ${peak.lon.toFixed(4)}° E`);
  add('Position check', `Wikidata ${peak.coordinates.wikidata} / OSM ${peak.coordinates.osm}: ${peak.coordinates.differenceM} m apart`);
  if (peak.note) add('Note', peak.note);
  FUTURE_FIELDS.forEach((field) => add(field, 'not available yet', 'pending'));
  panel.replaceChildren(element('h2', null, peak.name), rows);
}

export function startHimalayaApp({ signal, createScene, search = window.location.search, embedded = false } = {}) {
  const canvas = document.getElementById('himalayaStage');
  const labelHost = document.getElementById('himalayaLabels');
  const list = document.getElementById('himalayaPeakList');
  const panel = document.getElementById('himalayaPanel');
  const provenance = document.getElementById('himalayaProvenance');
  const notice = document.getElementById('himalayaNotice');
  document.body.classList.toggle('is-atlas-embedded', embedded);
  provenance.textContent = PROVENANCE_BAR_TEXT;

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => reducedMotionQuery.matches;
  let scene = null;
  let activeId = null;

  function select(id, { instant = false } = {}) {
    if (signal?.aborted) return;
    const peak = getHimalayaPeak(id);
    if (!peak) return;
    activeId = id;
    list.querySelectorAll('button[data-peak-id]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.peakId === id));
    });
    renderPanel(panel, peak);
    scene?.focusPeak(id, { instant });
  }

  list.replaceChildren(...HIMALAYA_PEAKS.map((peak) => {
    const item = element('li');
    const button = element('button', 'himalaya-peak-button');
    button.type = 'button';
    button.dataset.peakId = peak.id;
    button.setAttribute('aria-pressed', 'false');
    button.append(element('span', 'himalaya-peak-name', peak.name), element('span', 'himalaya-peak-elev', formatElevation(peak.elevationM)));
    button.addEventListener('click', () => select(peak.id));
    item.append(button);
    return item;
  }));

  // A missing WebGL2 leaves the list and the panel working.
  try {
    scene = createScene({
      canvas, labelHost, peaks: HIMALAYA_PEAKS, center: HIMALAYA_REGION_CENTER,
      onSelect: (id) => select(id), reducedMotion,
    });
  } catch (error) {
    notice.hidden = false;
    notice.textContent = `3D view unavailable (${error.message}). The peak list and details still work.`;
  }

  const initial = resolveInitialFocus(search);
  if (initial) select(initial, { instant: false });
  else renderPanel(panel, null);

  window.__livingHimalayaDebug = Object.freeze({
    snapshot: () => ({ activeId, initialFocus: initial, reducedMotion: reducedMotion(), scene: scene?.snapshot() || null }),
    select: (id) => select(id),
  });

  return () => {
    scene?.dispose();
    scene = null;
    delete window.__livingHimalayaDebug;
  };
}
