// Living Himalaya LOT 2-3: peak list, peak panel (bottom sheet below 760 px),
// terrain-detail switch (GLO-30 <-> Terrarium), Sun time slider, summit
// weather (Open-Meteo GFS pressure levels), night message and moonlight,
// permanent provenance bar and the terrain scene. Started and destroyed by the module
// host (living-himalaya-module.js); after destroy nothing restarts (async
// work checks the signal, timers and listeners are owned and removed).
import { HIMALAYA_ALL_PEAKS, HIMALAYA_REGION_CENTER, PEAK_GROUPS, getHimalayaPeak } from '../config/himalaya-peaks.js';
import { getTerrainPatch, patchKeyOf } from '../config/himalaya-terrain-patches.js';
import { createRequestRuntime } from '../core/runtime/request-runtime.js';
import { loadAstronomyEngine } from '../earth/astronomy-runtime.js';
import { createBottomSheet } from './bottom-sheet.js';
import { isPanelHotkey, readPanelState, toggleAll, viewOffsetY, writePanelState } from './ui-panels.js';
import { validateObservatoryTime } from '../core/observatory/observatory-messages.js';
import {
  ATTRIBUTIONS, TERRAIN_MODES, composeProvenanceBar, demElevationText, glo30FillNote,
} from './himalaya-provenance.js';
import {
  computeSun, dateAtUtcMinutes, formatClock, localMeanSolarMinutes, utcMinutesOfDay,
} from './sun-position.js';
import { isWeatherDay, summitWeatherRows, weatherBarSegment } from './summit-weather.js';
import { createSessionStorageCache, createWeatherClient } from './weather-client.js';
import { createAttemptLedger, createGuardedRuntime } from './request-guard.js';
import { computeMoon, nightMessage } from './moon-position.js';
import { createSentinelClient } from './sentinel-client.js';
import {
  LEVEL_20M, LEVEL_40M, STRETCH_LABEL, imageBarSegment, lightingLabel, selectionSummary, sentinelAttribution, shouldLoad20m,
} from './sentinel-scene.js';
import { createLru } from './terrarium.js';
import { historyRows, isCovered } from './hdb-history.js';
import { HIMALAYA_HISTORY_ASSET } from '../config/himalaya-history.js';

export const FUTURE_FIELDS = Object.freeze([]);
export const IMAGE_MODES = Object.freeze(['satellite', 'lit']);

/** Why Satellite is (not) shown; null when it is. */
export function satelliteReason({ userMode, terrainMode, sat, activeId }) {
  if (userMode !== 'satellite') return 'Lit terrain selected';
  if (!activeId) return 'select a summit for the Sentinel-2 image';
  if (terrainMode !== 'glo30') return 'Terrarium terrain detail: Satellite needs the GLO-30 patch — showing Lit terrain';
  if (!sat || sat.peakId !== activeId || sat.status === 'selecting') return 'looking for a clear Sentinel-2 scene…';
  if (sat.status === 'no-clear') return 'no clear scene in the last 30 days — showing Lit terrain';
  if (sat.status === 'error') return `Sentinel-2 unavailable (${sat.error}) — showing Lit terrain`;
  if (!sat.level) return 'loading the Sentinel-2 image (40 m)…';
  return null;
}
export const TIME_STEP_MINUTES = 10;

/** LOT 7: the summit list in two titled groups (14 eight-thousanders, 6 selected Nepal peaks). */
export function peakListGroups(peaks = HIMALAYA_ALL_PEAKS) {
  return Object.entries(PEAK_GROUPS)
    .map(([group, title]) => ({ group, title, peaks: peaks.filter((peak) => peak.group === group) }))
    .filter((entry) => entry.peaks.length);
}

/** Initial focus from ?focus=<peak id>; anything else -> null (overview). */
/** Scene time handed over by Living Earth (?time=, historical only), validated by the shared validator; null otherwise. */
export function resolveInitialTime(search, now = new Date()) {
  return validateObservatoryTime(new URLSearchParams(search || '').get('time'), now);
}

export function resolveInitialFocus(search) {
  const value = new URLSearchParams(search || '').get('focus');
  return value && getHimalayaPeak(value) ? value : null;
}

// Terrain tiles and patches go through the shared request runtime (timeouts,
// retries, abort, diagnostics, simulated-offline control) but are NOT copied
// into the persistent JSON/IndexedDB cache. The service worker is not
// registered (sw.js is kept but unused), so they have no persistent cache:
// only the in-memory LRUs of the scene (and the ordinary HTTP cache).
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

// External link (Himalayan Database home page): new tab, rel="noopener".
function externalLink({ href, text }) {
  const a = element('a', 'himalaya-external-link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
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
  const timeLabel = document.getElementById('himalayaTimeLabel');
  const timeSource = document.getElementById('himalayaTimeSource');
  const provenanceText = document.getElementById('himalayaProvenanceText');
  const provenanceToggle = document.getElementById('himalayaProvenanceToggle');
  const listPanel = document.getElementById('himalayaListPanel');
  const listCollapse = document.getElementById('himalayaListCollapse');
  const detailsCollapse = document.getElementById('himalayaDetailsCollapse');
  const timeNow = document.getElementById('himalayaTimeNow');
  const timeReadout = document.getElementById('himalayaTimeReadout');
  const sunReadout = document.getElementById('himalayaSunReadout');
  const terrainInputs = [...document.querySelectorAll('input[name="himalayaTerrain"]')];
  const sources = document.getElementById('himalayaSources');
  const night = document.getElementById('himalayaNight');
  const imageInputs = [...document.querySelectorAll('input[name="himalayaImage"]')];
  const imageNote = document.getElementById('himalayaImageNote');
  const imageBest = document.getElementById('himalayaImageBest');
  const nightText = document.getElementById('himalayaNightText');
  const nightMoon = document.getElementById('himalayaNightMoon');
  document.body.classList.toggle('is-atlas-embedded', embedded);

  const listeners = new AbortController();
  signal?.addEventListener('abort', () => listeners.abort(), { once: true });
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
  const alive = () => !signal?.aborted && !listeners.signal.aborted;

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => reducedMotionQuery.matches;
  const sheet = createBottomSheet({ panel, toggle: sheetToggle, signal: listeners.signal, onChange: () => queueMicrotask(() => { if (alive()) updateFraming(); }) });
  // One page-wide retry policy (request-guard.js): backoff 2 s / 4 s, at most
  // 3 failed attempts per resource per visit, then a final honest state.
  const attempts = createAttemptLedger();
  const guarded = (runtime) => createGuardedRuntime({ runtime, ledger: attempts });
  const terrainRuntime = guarded(createRequestRuntime({ cache: NON_PERSISTENT_CACHE }));
  let scene = null;
  let activeId = null;
  let terrainMode = 'glo30';
  let astronomy = null;
  let sunInfo = null;
  let moonInfo = null;
  let weatherState = null;
  // History aggregates (one small same-origin asset, loaded once, through the guarded runtime).
  const history = { status: 'idle', data: null };
  function loadHistory() {
    history.status = 'loading';
    terrainRuntime.fetchResource({
      key: 'himalaya-history', url: new URL(HIMALAYA_HISTORY_ASSET.file, document.baseURI).href, responseType: 'json',
      ttl: 0, staleTtl: 0, timeout: 15_000, signal: listeners.signal,
    }).then((result) => {
      if (!alive()) return;
      history.status = 'ready'; history.data = result.data;
      renderPanel();
    }).catch(() => {
      if (!alive()) return;
      history.status = 'error';
      renderPanel();
    });
  }
  // --- Sentinel-2 Satellite mode (Lot 4)
  let userImageMode = 'satellite';
  let sat = null; // { peakId, status, selection, pass, level, error, upgrading }
  let satController = null;
  const sentinel = createSentinelClient({ runtime: guarded(createRequestRuntime({ cache: NON_PERSISTENT_CACHE })) });
  const imageCache = createLru(2, (peakId) => scene?.clearSatelliteImage(peakId));
  const weather = createWeatherClient({
    runtime: guarded(createRequestRuntime({ cache: createSessionStorageCache() })),
    onChange: (state) => {
      if (!alive()) return;
      weatherState = state;
      if (state.peakId === activeId) { renderPanel(); updateProvenance(); }
    },
  });
  // Time: 'now' (live) or 'manual' on a UTC day (baseDay: null = today). A
  // historical time handed over by Living Earth fixes the day and the minutes.
  const searchParams = new URLSearchParams(search || '');
  const timeFromEarth = resolveInitialTime(search, now());
  const time = timeFromEarth
    ? { mode: 'manual', minutes: utcMinutesOfDay(new Date(timeFromEarth)), baseDay: new Date(timeFromEarth), fromEarth: timeFromEarth }
    : { mode: 'now', minutes: utcMinutesOfDay(now()), baseDay: null, fromEarth: null };
  const timeNotRestored = !timeFromEarth && searchParams.get('timeNote') === 'not-restored';

  // --- sources & attribution (the Sentinel-2 notice carries the year of the scene shown)
  function renderSources(sceneYear = null) {
    const sentinelEntry = {
      title: 'Sentinel-2 image (Satellite mode)',
      text: sceneYear ? sentinelAttribution(sceneYear) : 'Contains modified Copernicus Sentinel data [year of the scene shown]',
      note: 'Sentinel-2 L2A (atmospherically corrected with Sen2Cor), Cloud-Optimized GeoTIFFs found through Earth Search (Element 84) on AWS Open Data; bands B4/B3/B2 with one fixed stretch for every scene, reprojected from UTM onto the GLO-30 patch.',
    };
    sources.replaceChildren(...[...ATTRIBUTIONS, sentinelEntry].map((entry) => {
      const item = element('li');
      item.append(element('strong', null, entry.title), element('span', 'himalaya-source-text', entry.text), element('span', 'himalaya-source-note', entry.note));
      if (entry.link) {
        const linkLine = element('span', 'himalaya-source-link');
        linkLine.append(externalLink(entry.link));
        item.append(linkLine);
      }
      return item;
    }));
  }
  renderSources();

  function currentDate() {
    return time.mode === 'now' ? now() : dateAtUtcMinutes(time.baseDay || now(), time.minutes);
  }

  function updateProvenance() {
    const date = currentDate();
    const weatherForPeak = weatherState && weatherState.peakId === activeId ? weatherState : null;
    const imageSegment = satelliteShown() ? imageBarSegment(sat.pass) : 'Image: none (Lit terrain)';
    const patch = activeId ? getTerrainPatch(activeId) : null;
    provenanceText.textContent = composeProvenanceBar({ terrainMode, sun: sunInfo, date, weather: weatherBarSegment(activeId ? weatherForPeak || { status: 'loading' } : null, date), image: imageSegment, glo30Accessed: patch?.accessed || null });
    provenanceText.title = terrainMode === 'glo30' && patch ? glo30FillNote(patch) : '';
  }

  function renderPanel() {
    const peak = activeId ? getHimalayaPeak(activeId) : null;
    sheetLabel.textContent = peak ? `${peak.name} · ${formatElevation(peak.elevationM)}` : 'Summits, terrain and light';
    if (!peak) {
      details.replaceChildren(
        element('h2', null, '14 summits above 8000 m and 6 selected Nepal peaks'),
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
    const satForPeak = sat && sat.peakId === peak.id ? sat : null;
    if (satForPeak?.selection) add('Image', selectionSummary(satForPeak.selection, { upTo: time.fromEarth }));
    if (satelliteShown()) {
      add('Image shown', `${imageBarSegment(sat.pass).replace(/^Image: /, '')} · ${sat.level === LEVEL_20M ? '20 m' : `40 m${sat.upgradeFailed ? ' (20 m image unavailable — 40 m kept)' : ' (20 m below 15 km from the summit)'}`} · ${lightingLabel(sat.pass)}`);
      add('Colour', STRETCH_LABEL);
    } else add('Image shown', `none — ${satelliteReason({ userMode: userImageMode, terrainMode, sat, activeId: peak.id })}`, 'pending');
    add('Summit', `${peak.lat.toFixed(4)}° N, ${peak.lon.toFixed(4)}° E`);
    add('Position check', `Wikidata ${peak.coordinates.wikidata} / OSM ${peak.coordinates.osm}: ${peak.coordinates.differenceM} m apart`);
    if (peak.note) add('Note', peak.note);
    FUTURE_FIELDS.forEach((field) => add(field, 'not available yet', 'pending'));
    const weatherRows = element('dl', 'himalaya-panel-rows himalaya-weather-rows');
    const weatherForPeak = weatherState && weatherState.peakId === peak.id ? weatherState : null;
    summitWeatherRows({ peak, state: weatherForPeak, date: currentDate() }).forEach(([label, value, state]) => {
      weatherRows.append(element('dt', null, label), element('dd', state ? `is-${state}` : null, value));
    });
    const weatherSection = element('section', 'himalaya-weather');
    weatherSection.setAttribute('aria-label', 'Summit weather');
    weatherSection.append(element('h3', null, 'Summit weather'), weatherRows);
    // History (Lot 6): per-peak aggregates of The Himalayan Database ©, "reported".
    if (isCovered(peak.id) && history.status === 'idle') loadHistory();
    const historyList = element('dl', 'himalaya-panel-rows himalaya-history-rows');
    historyRows(peak.id, history.data, history.status).forEach(([label, value, state, link]) => {
      const dd = element('dd', state ? `is-${state}` : null, value);
      if (link) dd.append(' · ', externalLink(link));
      historyList.append(element('dt', null, label), dd);
    });
    const historySection = element('section', 'himalaya-weather himalaya-history');
    historySection.setAttribute('aria-label', 'History');
    historySection.append(element('h3', null, 'History'), historyList);
    details.replaceChildren(element('h2', null, peak.name), rows, weatherSection, historySection);
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
    timeLabel.textContent = time.baseDay ? `Sun time on ${time.baseDay.toISOString().slice(0, 10)} (UTC)` : 'Sun time on the current UTC day';
    timeSource.hidden = !(time.fromEarth || timeNotRestored);
    timeSource.textContent = time.fromEarth
      ? `Time from Living Earth: ${time.fromEarth.slice(0, 10)} ${time.fromEarth.slice(11, 16)} UTC (historical). “Now” returns to live.`
      : timeNotRestored ? 'The time from Living Earth is not restored after a reload — showing now.' : '';
    // The real Moon, and the night message for the selected summit and time.
    const moon = computeMoon({ date, lat, lon, heightM, Astronomy: astronomy });
    moonInfo = moon ? { ...moon, lat, lon } : null;
    scene?.setMoon(result.altitudeDeg <= 0 && moonInfo && moonInfo.altitudeDeg > 0 ? moonInfo : null);
    const message = peak ? nightMessage({ peakName: peak.name, sun: result, moon, isNow: time.mode === 'now' }) : null;
    night.hidden = !message;
    nightText.textContent = message ? `${message.text}${satelliteShown() ? ' (image: daylight as captured)' : ''}` : '';
    nightMoon.textContent = message?.moon || '';
    nightMoon.hidden = !message?.moon;
    if (peak) renderPanel();
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
    loadWeather(peak);
    loadSatellite(peak);
    renderPanel();
    updateSun();
  }

  function satelliteShown() {
    return Boolean(scene?.satelliteShown?.()) && !satelliteReason({ userMode: userImageMode, terrainMode, sat, activeId });
  }

  function applyImageMode() {
    if (!alive()) return;
    const reason = satelliteReason({ userMode: userImageMode, terrainMode, sat, activeId });
    scene?.setImageMode(reason ? 'lit' : 'satellite');
    imageInputs.forEach((input) => { input.checked = input.value === userImageMode; });
    imageNote.textContent = reason ? `Showing Lit terrain: ${reason}.` : `Satellite: ${lightingLabel(sat.pass)}. Sun, Moon and shadows are not applied to the image.${sat.upgradeFailed ? ' 20 m image unavailable — 40 m kept.' : ''}`;
    imageBest.hidden = !(sat && sat.peakId === activeId && sat.status === 'no-clear' && sat.selection?.best);
    if (!imageBest.hidden) imageBest.textContent = `Show the best available (${sat.selection.best.datetime.slice(0, 10)}, local cloud ${Math.round(sat.selection.best.localCloudPct ?? 0)}%)`;
    renderSources(satelliteShown() ? sat.pass.datetime.slice(0, 4) : null);
  }

  function showImage(peakId, image) {
    scene?.setSatelliteImage(peakId, image);
  }

  async function loadLevel(peak, levelIndex, signal) {
    const cached = imageCache.get(peak.id);
    if (cached?.passId === sat.pass.datatake && cached.images[levelIndex]) return cached.images[levelIndex];
    const image = await sentinel.image(peak, getTerrainPatch(peak.id), sat.pass, levelIndex, signal);
    const entry = cached?.passId === sat.pass.datatake ? cached : { passId: sat.pass.datatake, images: {} };
    entry.images[levelIndex] = image;
    imageCache.set(peak.id, entry, { isPinned: (key) => key === activeId });
    return image;
  }

  async function loadSatellite(peak, { useBest = false } = {}) {
    satController?.abort(new DOMException('Summit changed', 'AbortError'));
    satController = new AbortController();
    const { signal } = satController;
    const meta = getTerrainPatch(peak.id);
    if (!meta) { sat = { peakId: peak.id, status: 'error', error: 'no GLO-30 patch' }; applyImageMode(); return; }
    sat = { peakId: peak.id, status: 'selecting' };
    applyImageMode();
    try {
      const selection = await sentinel.select(peak, meta, signal, { asOf: time.fromEarth ? new Date(time.fromEarth) : null });
      if (signal.aborted) return;
      const pass = selection.status === 'clear' ? selection.pass : useBest ? selection.best : null;
      sat = { peakId: peak.id, status: pass ? 'loading' : 'no-clear', selection, pass, level: null, showingBest: Boolean(useBest && pass) };
      applyImageMode(); renderPanel(); updateProvenance();
      if (!pass) return;
      const cached = imageCache.get(peak.id);
      const best = cached?.passId === pass.datatake ? cached.images[LEVEL_20M] || cached.images[LEVEL_40M] : null;
      const image = best || await loadLevel(peak, LEVEL_40M, signal);
      if (signal.aborted) return;
      showImage(peak.id, image);
      sat.level = image.level; sat.status = 'ready'; sat.lastImage = { size: [image.width, image.height], stats: image.stats, reflectance: image.reflectanceSamples, tiles: image.tiles };
    } catch (error) {
      if (signal.aborted) return;
      sat = { ...(sat || {}), peakId: peak.id, status: 'error', error: error?.message || String(error) };
      console.warn('[Living Himalaya] Sentinel-2 unavailable.', error?.message || error);
    }
    applyImageMode(); renderPanel(); updateProvenance(); updateSun();
  }

  // 40 m -> 20 m once the camera is closer than the patch LOD threshold (one pass active).
  const upgradeTimer = setInterval(async () => {
    if (!alive() || !sat || sat.status !== 'ready' || sat.level !== LEVEL_40M || sat.upgrading || sat.upgradeFailed || sat.peakId !== activeId) return;
    if (!shouldLoad20m(scene?.summitDistanceKm())) return;
    const mine = sat; const signal = satController.signal;
    mine.upgrading = true;
    try {
      const peak = getHimalayaPeak(mine.peakId);
      const image = await loadLevel(peak, LEVEL_20M, signal);
      if (signal.aborted || sat !== mine) return;
      showImage(peak.id, image);
      mine.level = LEVEL_20M; mine.lastImage = { size: [image.width, image.height], stats: image.stats, reflectance: image.reflectanceSamples, tiles: image.tiles };
      applyImageMode(); renderPanel(); updateProvenance();
    } catch (error) {
      // One attempt per pass: a failure keeps 40 m and is not retried by the timer.
      if (!signal.aborted) { mine.upgradeFailed = true; console.warn('[Living Himalaya] Sentinel-2 20 m unavailable; keeping 40 m.', error?.message || error); applyImageMode(); renderPanel(); }
    } finally { mine.upgrading = false; }
  }, 400);

  function setImageMode(mode) {
    if (!IMAGE_MODES.includes(mode) || !alive()) return;
    userImageMode = mode;
    applyImageMode(); renderPanel(); updateProvenance(); updateSun();
  }

  function setTerrainMode(mode) {
    if (!TERRAIN_MODES.includes(mode) || !alive()) return;
    terrainMode = mode;
    terrainInputs.forEach((input) => { input.checked = input.value === mode; });
    scene?.setTerrainMode(mode);
    applyImageMode();
    renderPanel();
    updateProvenance();
  }

  list.replaceChildren(...peakListGroups().flatMap(({ group, title, peaks }, index) => [
    Object.assign(element('li', `himalaya-peak-group${index ? ' is-later' : ''}`, title), { id: `himalayaGroup-${group}` }),
    ...peaks.map((peak) => {
      const item = element('li');
      const button = element('button', `himalaya-peak-button${group === 'selected-nepal' ? ' is-selected-peak' : ''}`);
      button.type = 'button';
      button.dataset.peakId = peak.id;
      button.dataset.group = group;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-describedby', `himalayaGroup-${group}`);
      button.append(element('span', 'himalaya-peak-name', peak.name), element('span', 'himalaya-peak-elev', formatElevation(peak.elevationM)));
      on(button, 'click', () => select(peak.id));
      item.append(button);
      return item;
    }),
  ]));
  terrainInputs.forEach((input) => on(input, 'change', () => { if (input.checked) setTerrainMode(input.value); }));
  imageInputs.forEach((input) => on(input, 'change', () => { if (input.checked) setImageMode(input.value); }));
  on(imageBest, 'click', () => { const peak = getHimalayaPeak(activeId); if (peak) loadSatellite(peak, { useBest: true }); });
  // "Now": back to live; a time from Living Earth is dropped, the weather and
  // the Sentinel-2 selection follow "now" again (the slider never re-selects).
  function goLive() {
    const wasHistorical = Boolean(time.fromEarth);
    time.mode = 'now'; time.baseDay = null; time.fromEarth = null;
    const peak = activeId ? getHimalayaPeak(activeId) : null;
    if (peak && weatherState?.status === 'other-day') loadWeather(peak);
    if (peak && wasHistorical) loadSatellite(peak);
    updateSun();
  }

  function loadWeather(peak) {
    if (!isWeatherDay(currentDate(), now())) {
      weather.clear();
      weatherState = { peakId: peak.id, status: 'other-day' };
      return;
    }
    weatherState = null;
    weather.load(peak);
  }

  on(timeSlider, 'input', () => {
    time.mode = 'manual';
    time.minutes = Number(timeSlider.value);
    updateSun();
  });
  on(timeNow, 'click', () => goLive());
  const ticker = setInterval(() => { if (time.mode === 'now') updateSun(); }, 60_000);

  // --- collapsible desktop panels (button on each panel + "H"), provenance bar (one line / expanded)
  const desktop = window.matchMedia('(min-width: 761px)');
  let panelState = readPanelState(window.sessionStorage);
  function setPanels(next) {
    panelState = { ...next };
    listPanel.classList.toggle('is-collapsed', panelState.list);
    panel.classList.toggle('is-collapsed', panelState.details);
    document.body.classList.toggle('panels-collapsed', panelState.list && panelState.details);
    listCollapse.setAttribute('aria-expanded', String(!panelState.list));
    listCollapse.title = panelState.list ? 'Show the summit list (H)' : 'Hide the summit list (H)';
    detailsCollapse.setAttribute('aria-expanded', String(!panelState.details));
    detailsCollapse.title = panelState.details ? 'Show the details panel (H)' : 'Hide the details panel (H)';
    provenance.classList.toggle('is-expanded', panelState.provenance);
    provenanceToggle.setAttribute('aria-expanded', String(panelState.provenance));
    provenanceToggle.textContent = panelState.provenance ? 'Less' : 'More';
    writePanelState(window.sessionStorage, panelState);
  }
  on(listCollapse, 'click', () => setPanels({ ...panelState, list: !panelState.list }));
  on(detailsCollapse, 'click', () => setPanels({ ...panelState, details: !panelState.details }));
  on(provenanceToggle, 'click', () => setPanels({ ...panelState, provenance: !panelState.provenance }));
  on(window, 'keydown', (event) => {
    if (!desktop.matches || !isPanelHotkey(event)) return;
    event.preventDefault();
    setPanels(toggleAll(panelState));
  });
  setPanels(panelState);

  // --- mobile framing: summit in the middle of the band above the bottom sheet
  function updateFraming() {
    if (!scene) return;
    if (desktop.matches) { scene.setViewOffsetY(0); return; }
    const height = window.innerHeight;
    const top = list.getBoundingClientRect().bottom;
    const bottom = panel.getBoundingClientRect().top;
    scene.setViewOffsetY(viewOffsetY({ height, top, bottom }));
  }
  const framingObserver = new ResizeObserver(() => updateFraming());
  framingObserver.observe(panel);
  on(window, 'resize', () => updateFraming());
  listeners.signal.addEventListener('abort', () => framingObserver.disconnect(), { once: true });
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
      canvas, labelHost, peaks: HIMALAYA_ALL_PEAKS, center: HIMALAYA_REGION_CENTER,
      onSelect: (id) => select(id), reducedMotion,
      fetchTile: async (url, key, requestSignal) => (await terrainRuntime.fetchResource({
        key, url, responseType: 'blob', ttl: 0, staleTtl: 0, retries: 1, timeout: 15_000, signal: requestSignal,
      })).data,
      fetchPatch: async (file, key, requestSignal) => (await terrainRuntime.fetchResource({
        key, url: new URL(file, document.baseURI).href, responseType: 'arrayBuffer', ttl: 0, staleTtl: 0, retries: 1, timeout: 30_000, signal: requestSignal,
      })).data,
      getPatchMeta: getTerrainPatch,
      getPatchKey: patchKeyOf,
      onTerrainEvent: (event) => {
        if (!alive()) return;
        // Patch events carry the patch key (Yalung Kang -> kangchenjunga); Terrarium events the peak id.
        if (activeId && (event.peakId === activeId || event.peakId === patchKeyOf(activeId))) renderPanel();
      },
    });
  } catch (error) {
    notice.hidden = false;
    notice.textContent = `3D view unavailable (${error.message}). The peak list and details still work.`;
  }

  updateFraming();
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
      time: { ...time, date: currentDate().toISOString() }, sun: sunInfo, moon: moonInfo, sheet: sheet.state,
      history: { status: history.status, rows: activeId ? Object.fromEntries(historyRows(activeId, history.data, history.status).map(([k, v]) => [k, v])) : null },
      weather: weatherState ? { peakId: weatherState.peakId, status: weatherState.status, fromCache: weatherState.fromCache || false, cacheAgeMs: weatherState.cacheAgeMs ?? null, error: weatherState.error || null } : null,
      weatherRows: activeId ? Object.fromEntries(summitWeatherRows({ peak: getHimalayaPeak(activeId), state: weatherState && weatherState.peakId === activeId ? weatherState : null, date: currentDate() }).map(([k, v]) => [k, v])) : null,
      night: night.hidden ? null : { text: nightText.textContent, moon: nightMoon.hidden ? null : nightMoon.textContent },
      satellite: sat ? { peakId: sat.peakId, status: sat.status, level: sat.level ?? null, error: sat.error || null, selection: sat.selection ? { status: sat.selection.status, fromCache: sat.selection.fromCache, passes: sat.selection.passes, evaluated: sat.selection.evaluated, pass: sat.selection.pass && { datetime: sat.selection.pass.datetime, scene: sat.selection.pass.sceneCloudPct, local: sat.selection.pass.localCloudPct, tiles: sat.selection.pass.tiles.map((t) => `${t.tile}:${t.localCloudPct == null ? 'n/a' : t.localCloudPct.toFixed(1)}`) }, best: sat.selection.best && { datetime: sat.selection.best.datetime, scene: sat.selection.best.sceneCloudPct, local: sat.selection.best.localCloudPct } } : null, lastImage: sat.lastImage || null, shown: satelliteShown(), reason: satelliteReason({ userMode: userImageMode, terrainMode, sat, activeId }) } : null,
      sentinelRequests: sentinel.requests,
      failedAttempts: attempts.snapshot(),
      summitDistanceKm: scene?.summitDistanceKm?.() ?? null,
      upgradeFailed: Boolean(sat?.upgradeFailed),
      imageNote: imageNote.textContent,
      provenance: provenanceText.textContent, provenanceExpanded: panelState.provenance, panels: { ...panelState }, viewOffsetY: scene?.viewOffsetY?.() ?? 0,
      timeFromEarth: time.fromEarth, timeNote: timeSource.hidden ? null : timeSource.textContent, scene: scene?.snapshot() || null,
    }),
    select: (id) => select(id),
    setTerrainMode,
    setTimeMinutes: (minutes) => { time.mode = 'manual'; time.minutes = minutes; updateSun(); },
    setNow: () => goLive(),
    panels: () => ({ ...panelState }),
    togglePanels: () => setPanels(toggleAll(panelState)),
    overview: (options) => { activeId = null; weather.clear(); weatherState = null; scene?.overview(options); renderPanel(); updateSun(); },
    measureShadowCost: (samples) => scene?.measureShadowCost(samples) || null,
    measureShadowCostGpu: (samples) => scene?.measureShadowCostGpu(samples) || null,
    view: (target, position) => scene?.setView(target, position),
    debugOverviewClip: (enabled) => scene?.debugOverviewClip(enabled),
    setImageMode,
    showBestAvailable: () => { const peak = getHimalayaPeak(activeId); if (peak) loadSatellite(peak, { useBest: true }); },
  });

  return () => {
    listeners.abort();
    clearInterval(ticker);
    clearInterval(upgradeTimer);
    satController?.abort(new DOMException('Living Himalaya disposed', 'AbortError'));
    weather.dispose();
    sheet.dispose();
    terrainRuntime.abortAll?.();
    scene?.dispose();
    scene = null;
    delete window.__livingHimalayaDebug;
  };
}
