// Sprint 1.4 (Faza 1) — global UTC time scrub, wired to createEarthTimeState().
// Astronomy follows the full scene time. Since LOT 5 the data layers follow
// its UTC day (earthTimeState.subscribeDataDay): EONET, USGS and Snow & ice
// load that day; layers without history are hidden with a "not available"
// status and come back in Live.
const DAY_MS = 86_400_000;

export function createTimeScrubPanel({
    timeState,
    sliderId = 'timeScrubSlider',
    labelId = 'timeScrubLabel',
    panelId = 'timeScrubPanel',
    presetIds = { 0: 'timeScrubLive', 7: 'timeScrubPreset7', 30: 'timeScrubPreset30', 365: 'timeScrubPreset365' },
    debounceMs = 180
}) {
    const byId = id => document.getElementById(id);
    const slider = byId(sliderId);
    const label = byId(labelId);
    const panel = byId(panelId);
    if (!slider || !label || typeof timeState?.subscribe !== 'function') {
        return { dispose() {} };
    }

    const dateFormat = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    let debounceHandle = null;
    let disposed = false;

    const liveLabel = 'Live astronomy · latest available data';
    const historicalNotice = 'Astronomy follows the scene time. EONET, USGS and Snow & ice show this UTC day; layers without history are hidden.';
    let notice = panel?.querySelector?.('[data-temporal-notice]');
    if (panel && !notice) {
        notice = document.createElement('div');
        notice.dataset.temporalNotice = 'true';
        notice.setAttribute('role', 'note');
        notice.style.cssText = 'display:none;margin-top:7px;font-size:11px;line-height:1.35;color:#b8d4e6;';
        panel.appendChild(notice);
    }

    function formatDaysAgo(daysAgo) {
        return daysAgo <= 0 ? liveLabel : `${dateFormat.format(new Date(Date.now() - daysAgo * DAY_MS))} UTC (historical)`;
    }

    function applyDaysAgo(daysAgo) {
        if (daysAgo <= 0) timeState.useLiveTime();
        else timeState.setHistoricalTime(new Date(Date.now() - daysAgo * DAY_MS));
    }

    function renderFromSnapshot(snapshot) {
        label.textContent = snapshot.historical
            ? `${dateFormat.format(snapshot.date)} UTC (historical)`
            : liveLabel;
        if (panel) panel.dataset.mode = snapshot.historical ? 'historical' : 'live';
        if (notice) {
            notice.hidden = !snapshot.historical;
            notice.style.display = snapshot.historical ? 'block' : 'none';
            notice.textContent = snapshot.historical ? historicalNotice : '';
        }
    }

    function onSliderInput(event) {
        const daysAgo = Number(event.target.value) || 0;
        // Label updates immediately for feedback; the actual timeState commit
        // (which recomputes solar/lunar position) is debounced so dragging
        // doesn't force a recompute on every pixel of motion.
        label.textContent = formatDaysAgo(daysAgo);
        if (debounceHandle) clearTimeout(debounceHandle);
        debounceHandle = setTimeout(() => {
            debounceHandle = null;
            applyDaysAgo(daysAgo);
        }, debounceMs);
    }

    function onPreset(daysAgo) {
        if (debounceHandle) {
            clearTimeout(debounceHandle);
            debounceHandle = null;
        }
        slider.value = String(daysAgo);
        applyDaysAgo(daysAgo);
    }

    slider.addEventListener('input', onSliderInput);
    const presetHandlers = Object.entries(presetIds)
        .map(([daysAgo, id]) => {
            const button = byId(id);
            if (!button) return null;
            const handler = () => onPreset(Number(daysAgo));
            button.addEventListener('click', handler);
            return { button, handler };
        })
        .filter(Boolean);

    const unsubscribe = timeState.subscribe(renderFromSnapshot);
    renderFromSnapshot(timeState.snapshot());

    function dispose() {
        if (disposed) return;
        disposed = true;
        if (debounceHandle) clearTimeout(debounceHandle);
        slider.removeEventListener('input', onSliderInput);
        presetHandlers.forEach(({ button, handler }) => button.removeEventListener('click', handler));
        unsubscribe();
    }

    return { dispose };
}
