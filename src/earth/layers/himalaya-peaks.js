// Himalaya LOT 1: the 14 eight-thousanders as selectable points on the globe;
// LOT 7: plus 6 selected Nepal peaks in a second, smaller marker style.
// Data is the frozen local reference list (src/config/himalaya-peaks.js), no
// request. Off by default; turned on by the "Himalaya peaks" button or by
// focus=himalaya (returning from Living Himalaya). Selecting a summit shows its
// details with an "Enter Living Himalaya" action.
import { HIMALAYA_ALL_PEAKS, HIMALAYA_PEAKS, HIMALAYA_SELECTED_PEAKS, PEAK_GROUPS } from '../../config/himalaya-peaks.js';
import { EARTH_TIME_CAPABILITIES } from '../temporal-provenance.js';
import { OBSERVATORY_ENTER_MESSAGE } from '../../core/observatory/observatory-messages.js';

function formatElevation(value) {
    return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })} m`;
}

export const MARKER_STYLES = Object.freeze({
    'eight-thousanders': Object.freeze({ size: 9, color: 0x9fe8ff }),
    'selected-nepal': Object.freeze({ size: 6, color: 0xc4b5fd }),
});
export const HIMALAYA_PEAKS_COUNT_LABEL = `${HIMALAYA_PEAKS.length} eight-thousanders + ${HIMALAYA_SELECTED_PEAKS.length} selected peaks`;

function buildDetail(peak) {
    const lines = [
        { label: 'Group', value: PEAK_GROUPS[peak.group] || peak.group },
        { label: 'Range', value: peak.range },
        { label: 'Elevation', value: `${formatElevation(peak.elevationM)} (${peak.elevationSource})` },
    ];
    if (peak.alternateElevations.length) {
        lines.push({ label: 'Other published values', value: peak.alternateElevations.map((entry) => `${formatElevation(entry.elevationM)} (${entry.source})`).join('; ') });
    }
    lines.push({ label: 'Summit', value: `${peak.lat.toFixed(4)} lat, ${peak.lon.toFixed(4)} lon` });
    lines.push({ label: 'Position check', value: `Wikidata ${peak.coordinates.wikidata} vs OSM ${peak.coordinates.osm}: ${peak.coordinates.differenceM} m apart` });
    if (peak.note) lines.push({ label: 'Note', value: peak.note });
    lines.push({ label: 'Source', value: 'Reference list (sources cited), local' });
    return lines;
}

/**
 * Open Living Himalaya on this peak. Inside the Atlas (embedded iframe) the
 * host page mounts it (strictly checked postMessage); standalone, the page is
 * opened directly.
 */
// Scene time of the Earth timeline (Himalaya LOT 5): set by app-services to
// timeState.snapshot. The time travels only when the timeline is NOT on Live.
let sceneTimeProvider = null;
export function setHimalayaSceneTimeProvider(provider) {
    sceneTimeProvider = typeof provider === 'function' ? provider : null;
}
export function historicalSceneTime(provider = sceneTimeProvider) {
    const snapshot = provider?.();
    return snapshot?.historical && snapshot.date instanceof Date ? snapshot.date.toISOString() : null;
}

export function enterHimalaya(peakId, { win = window, time = historicalSceneTime() } = {}) {
    const embedded = win.parent && win.parent !== win;
    if (embedded) {
        const message = { type: OBSERVATORY_ENTER_MESSAGE, id: 'living-himalaya', focus: peakId };
        if (time) message.time = time;
        win.parent.postMessage(message, win.location.origin);
        return 'message';
    }
    const target = new URL('./living-himalaya.html', win.location.href);
    target.searchParams.set('focus', peakId);
    if (time) target.searchParams.set('time', time);
    win.location.assign(target.href);
    return 'navigate';
}

export const himalayaPeaksPlugin = {
    id: 'himalayaPeaks',
    label: 'Himalaya peaks',
    sourceKey: 'himalayaPeaks', // provenance from source-registry ('observed')
    temporal: { temporalType: 'static-reference', sceneTimeCompatibility: 'static', cacheState: 'unknown' },
    timeCapability: EARTH_TIME_CAPABILITIES.himalayaPeaks,
    attribution: 'Reference list (sources cited)',
    license: 'Facts compiled from cited references; Wikidata CC0, OpenStreetMap ODbL.',
    source: { url: 'local:himalaya-peaks', requiresProxy: false, apiKey: null },
    render: 'points',
    local: true,
    /** Status text: "Himalaya peaks: 14 eight-thousanders + 6 selected peaks (…)". */
    countLabel: () => HIMALAYA_PEAKS_COUNT_LABEL,
    async fetch() {
        return HIMALAYA_ALL_PEAKS;
    },
    normalize(peaks) {
        return peaks.map((peak) => ({
            lon: peak.lon,
            lat: peak.lat,
            ...(MARKER_STYLES[peak.group] || MARKER_STYLES['eight-thousanders']),
            group: peak.group,
            title: `${peak.name} · ${formatElevation(peak.elevationM)}`,
            detail: buildDetail(peak),
            action: { label: 'Enter Living Himalaya →', run: () => enterHimalaya(peak.id) },
        }));
    },
};
