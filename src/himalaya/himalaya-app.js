// Living Himalaya LOT 2: peak list, peak panel (bottom sheet below 760 px),
// terrain-detail switch (GLO-30 <-> Terrarium), Sun time slider, permanent
// provenance bar and the terrain scene. Started and destroyed by the module
// host (living-himalaya-module.js); after destroy nothing restarts (async
// work checks the signal, timers and listeners are owned and removed).
import { HIMALAYA_PEAKS, HIMALAYA_REGION_CENTER, getHimalayaPeak } from '../config/himalaya-peaks.js';
import { getTerrainPatch } from '../config/himalaya-terrain-patches.js';
import { createRequestRuntime } from '../core/runtime/request-runtime.js';
import { loadAstronomyEngine } from '../earth/astronomy-runtime.js';
import { createBottomSheet } from './bottom-sheet.js';
import {
  ATTRIBUTIONS, TERRAIN_MODES, composeProvenanceBar, demElevationText, glo30FillNote,
} from './himalaya-provenance.js';
import {
  computeSun, dateAtUtcMinutes, formatClock, localMeanSolarMinutes, utcMinutesOfDay,
} from './sun-position.js';

export const FUTURE_FIELDS = Object.freeze(['Weather', 'Image', 'History']);
export const TIME_STEP_MINUTES = 10;

/** Initial focus from ?focus=<peak id>; anything else -> null (overview). */
export function resolveInitialFocus(search) {
  const value = new URLSearchParams(search || '').get('focus');
  return value && getHimalayaPeak(value) ? value : null;
}

// Terrain tiles and patches go through the shared request runtime (timeouts,
// retries, abort, diagnostics, simulated-offline control) but are NOT copied
// into the persistent JSON/IndexedDB cache: the service worker caches them
// (lea-terrain-v1 for Terrarium, lea-himalaya-v1 for the hashed patches).
const NON_PERSISTENT_CACHE = Object.freeze({
  get: async () => null,
  set: async (key, value, meta = {}) => ({ key, value, storedAt: Date.now(), ...meta }),
  touch: async () => null,
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatElevation(value) {
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })} m`;
}

export function terrainRowText(mode, patch, patchState) {
  if (mode === 'terrarium') return 'Terrarium / AWS Terrain Tiles (reconstructed), zoom 6/8/9 (~1.9 km to ~0.25 km per pixel); GLO-30 detail switched off';
  if (!patch) return 'No GLO-30 patch for this summit';
  if (patchState === 'error') return 'GLO-30 patch unavailable; the Terrarium overview stays visible';
  const base = 'Copernicus GLO-30 (reconstructed), 1 arc-second, 20 × 20 km around the summit';
  return `${base}${patchState === 'loading' ? ' — loading…' : ''}. ${glo30FillNote(patch)}.`;
}

export function demRowText(mode, patch, terrariumSummit) {
  if (mode === 'glo30' && patch) return demElevationText(patch.demSummitM, `Copernicus GLO-30, highest sample within ${patch.demSummitRadiusM} m`);
  if (mode === 'terrarium' && terrariumSummit) return demElevationText(terrariumSummit.valueM, `Terrarium z${terrariumSummit.z}, highest of ${terrariumSummit.window}`);
  return null;
}

export function startHimalayaApp({
  signal, createScene, search = window.location.search, embedded = false,
  now = () => new Date(), loadAstronomy = loadAstronomyEngine,
} = {}) {
  const canvas = document.getElementById('himalayaStage');
  const labelHost = document.getElementById('himalayaLabels');
  const list = document.getElementById('himalayaPeakList');
  const panel = document.getElementById('himalayaPanel');
  const details = document.getElementById('himalayaDetails');
  const sheetToggle = document.getElementById('himalayaSheetToggle');
  const sheetLabel = document.getElementById('himalayaSheetLabel');
  const provenance = document.getElementById('himalayaProvenance');
  const notice = document.getElementById('himalayaNotice');
  const timeSlider = document.getElementById('himalayaTime');
  const timeNow = document.getElementById('himalayaTimeNow');
  const timeReadout = document.getElementById('himalayaTimeReadout');
  const sunReadout = document.getElementById('himalayaSunReadout');
  const terrainInputs = [...document.querySelectorAll('input[name="himalayaTerrain"]')];
  const sources = document.getElementById('himalayaSources');
  document.body.classList.toggle('is-atlas-embedded', embedded);

  const listeners = new AbortController();
  signal?.addEventListener('abort', () => listeners.abort(), { once: true });
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const alive = () => !signal?.aborted && !listeners.signal.aborted;

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => reducedMotionQuery.matches;
  const sheet = createBottomSheet({ panel, toggle: sheetToggle, signal: listeners.signal });
  const terrainRuntime = createRequestRuntime({ cache: NON_PERSISTENT_CACHE });
  let scene = null;
  let activeId = null;
  let terrainMode = 'glo30';
  let astronomy = null;
  let sunInfo = null;
  const time = { mode: 'now', minutes: utcMinutesOfDay(now()) };

  // --- sources & attribution
  sources.replaceChildren(...ATTRIBUTIONS.map((entry) => {
    const item = element('li');
    item.append(element('strong', null, entry.title), element('span', 'himalaya-source-text', entry.text), element('span', 'himalaya-source-note', entry.note));
    return item;
  }));

  function currentDate() {
    return time.mode === 'now' ? now() : dateAtUtcMinutes(now(), time.minutes);
  }

  function updateProvenance() {
    provenance.textContent = composeProvenanceBar({ terrainMode, sun: sunInfo, date: currentDate() });
    const patch = activeId ? getTerrainPatch(activeId) : null;
    provenance.title = terrainMode === 'glo30' && patch ? glo30FillNote(patch) : '';
  }

  function renderPanel() {
    const peak = activeId ? getHimalayaPeak(activeId) : null;
    sheetLabel.textContent = peak ? `${peak.name} · ${formatElevation(peak.elevationM)}` : 'Summits, terrain and light';
    if (!peak) {
      details.replaceChildren(
        element('h2', null, '14 summits above 8000 m'),
        element('p', 'himalaya-panel-hint', 'Choose a summit from the list or click a marker. Terrain is lit by the Sun for the selected time; vertical exaggeration 1.0.'),
      );
      return;
    }
    const patch = getTerrainPatch(peak.id);
    const rows = element('dl', 'himalaya-panel-rows');
    const add = (label, value, state = '') => {
      if (value == null) return;
      rows.append(element('dt', null, label), element('dd', state ? `is-${state}` : null, value));
    };
    add('Range', peak.range);
    add('Elevation', `${formatElevation(peak.elevationM)} — ${peak.elevationSource}`);
    if (peak.alternateElevations.length) {
      add('Other published', peak.alternateElevations.map((entry) => `${formatElevation(entry.elevationM)} (${entry.source})`).join('; '));
    }
    add('DEM elevation', demRowText(terrainMode, patch, scene?.terrariumSummit(peak.id)) || 'DEM elevation (model): loading…', 'model');
    add('Terrain', terrainRowText(terrainMode, patch, scene?.patchState(peak.id)));
    add('Summit', `${peak.lat.toFixed(4)}° N, ${peak.lon.toFixed(4)}° E`);
    add('Position check', `Wikidata ${peak.coordinates.wikidata} / OSM ${peak.coordinates.osm}: ${peak.coordinates.differenceM} m apart`);
    if (peak.note) add('Note', peak.note);
    FUTURE_FIELDS.forEach((field) => add(field, 'not available yet', 'pending'));
    details.replaceChildren(element('h2', null, peak.name), rows);
  }

  function updateSun() {
    if (!alive()) return;
    const date = currentDate();
    const peak = activeId ? getHimalayaPeak(activeId) : null;
    const lat = peak ? peak.lat : HIMALAYA_REGION_CENTER.lat;
    const lon = peak ? peak.lon : HIMALAYA_REGION_CENTER.lon;
    const heightM = peak ? peak.elevationM : 0;
    const result = computeSun({ date, lat, lon, heightM, Astronomy: astronomy });
    sunInfo = { ...result, lat, lon };
    scene?.setSun({ ...result, lat, lon });
    const utc = date.getUTCHours() * 60 + date.getUTCMinutes();
    timeSlider.value = String(time.mode === 'now' ? Math.round(utc / TIME_STEP_MINUTES) * TIME_STEP_MINUTES : time.minutes);
    const place = peak ? peak.name : 'region centre';
    timeReadout.textContent = `${date.toISOString().slice(0, 10)} · ${formatClock(utc)} UTC · local mean solar time ${formatClock(localMeanSolarMinutes(date, lon))} (${place}, ${lon.toFixed(2)}° E)${time.mode === 'now' ? ' · now' : ''}`;
    const below = result.altitudeDeg <= 0;
    sunReadout.textContent = `Sun ${below ? 'below the horizon' : `azimuth ${result.azimuthDeg.toFixed(1)}°, altitude ${result.altitudeDeg.toFixed(1)}°`}`
      + `${result.source === 'approximate' ? ' — approximate' : ''}`;
    sunReadout.dataset.source = result.source;
    timeNow.setAttribute('aria-pressed', String(time.mode === 'now'));
    updateProvenance();
  }

  function select(id, { instant = false } = {}) {
    if (!alive()) return;
    const peak = getHimalayaPeak(id);
    if (!peak) return;
    activeId = id;
    list.querySelectorAll('button[data-peak-id]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.peakId === id));
    });
    list.querySelector(`button[data-peak-id="${id}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    scene?.focusPeak(id, { instant });
    sheet.reveal();
    renderPanel();
    updateSun();
  }

  function setTerrainMode(mode) {
    if (!TERRAIN_MODES.includes(mode) || !alive()) return;
    terrainMode = mode;
    terrainInputs.forEach((input) => { input.checked = input.value === mode; });
    scene?.setTerrainMode(mode);
    renderPanel();
    updateProvenance();
  }

  list.replaceChildren(...HIMALAYA_PEAKS.map((peak) => {
    const item = element('li');
    const button = element('button', 'himalaya-peak-button');
    button.type = 'button';
    button.dataset.peakId = peak.id;
    button.setAttribute('aria-pressed', 'false');
    button.append(element('span', 'himalaya-peak-name', peak.name), element('span', 'himalaya-peak-elev', formatElevation(peak.elevationM)));
    on(button, 'click', () => select(peak.id));
    item.append(button);
    return item;
  }));
  terrainInputs.forEach((input) => on(input, 'change', () => { if (input.checked) setTerrainMode(input.value); }));
  on(timeSlider, 'input', () => {
    time.mode = 'manual';
    time.minutes = Number(timeSlider.value);
    updateSun();
  });
  on(timeNow, 'click', () => { time.mode = 'now'; updateSun(); });
  const ticker = setInterval(() => { if (time.mode === 'now') updateSun(); }, 60_000);
  listeners.signal.addEventListener('abort', () => clearInterval(ticker), { once: true });
  // The panel / bottom sheet sits above the provenance bar, whatever its height.
  const provenanceObserver = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--himalaya-prov-h', `${provenance.offsetHeight}px`);
  });
  provenanceObserver.observe(provenance);
  listeners.signal.addEventListener('abort', () => provenanceObserver.disconnect(), { once: true });

  // A missing WebGL2 leaves the list and the panel working.
  try {
    scene = createScene({
      canvas, labelHost, peaks: HIMALAYA_PEAKS, center: HIMALAYA_REGION_CENTER,
      onSelect: (id) => select(id), reducedMotion,
      fetchTile: async (url, key, requestSignal) => (await terrainRuntime.fetchResource({
        key, url, responseType: 'blob', ttl: 0, staleTtl: 0, retries: 1, timeout: 15_000, signal: requestSignal,
      })).data,
      fetchPatch: async (file, key, requestSignal) => (await terrainRuntime.fetchResource({
        key, url: new URL(file, document.baseURI).href, responseType: 'arrayBuffer', ttl: 0, staleTtl: 0, retries: 1, timeout: 30_000, signal: requestSignal,
      })).data,
      getPatchMeta: getTerrainPatch,
      onTerrainEvent: (event) => {
        if (!alive()) return;
        if (event.peakId === activeId) renderPanel();
      },
    });
  } catch (error) {
    notice.hidden = false;
    notice.textContent = `3D view unavailable (${error.message}). The peak list and details still work.`;
  }

  const initial = resolveInitialFocus(search);
  if (initial) select(initial, { instant: false });
  else { renderPanel(); updateSun(); }

  loadAstronomy().then((engine) => {
    if (!alive() || !engine) return;
    astronomy = engine;
    updateSun();
  }).catch(() => { /* the approximate model stays, labelled */ });

  window.__livingHimalayaDebug = Object.freeze({
    snapshot: () => ({
      activeId, initialFocus: initial, reducedMotion: reducedMotion(), terrainMode,
      time: { ...time, date: currentDate().toISOString() }, sun: sunInfo, sheet: sheet.state,
      provenance: provenance.textContent, scene: scene?.snapshot() || null,
    }),
    select: (id) => select(id),
    setTerrainMode,
    setTimeMinutes: (minutes) => { time.mode = 'manual'; time.minutes = minutes; updateSun(); },
    setNow: () => { time.mode = 'now'; updateSun(); },
    overview: (options) => { activeId = null; scene?.overview(options); renderPanel(); updateSun(); },
    measureShadowCost: (samples) => scene?.measureShadowCost(samples) || null,
    measureShadowCostGpu: (samples) => scene?.measureShadowCostGpu(samples) || null,
    view: (target, position) => scene?.setView(target, position),
  });

  return () => {
    listeners.abort();
    clearInterval(ticker);
    sheet.dispose();
    terrainRuntime.abortAll?.();
    scene?.dispose();
    scene = null;
    delete window.__livingHimalayaDebug;
  };
}
