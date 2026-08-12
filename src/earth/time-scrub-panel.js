// Sprint 1.4 (Faza 1) — global UTC time scrub. Wired directly to the
// existing createEarthTimeState() store, which already drives solar/lunar
// position reactively (see app-visual-foundation.js). GIBS imagery layers
// (daily clouds, night lights) are not temporal-aware yet — clouds are
// disabled pending validation and night lights are fixed to 2012/2016 — so
// this control is scoped honestly to astronomy for now, not sold as full
// data-layer time travel.
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

    function formatDaysAgo(daysAgo) {
        return daysAgo <= 0 ? 'Live' : `${dateFormat.format(new Date(Date.now() - daysAgo * DAY_MS))} UTC (historical)`;
    }

    function applyDaysAgo(daysAgo) {
        if (daysAgo <= 0) timeState.useLiveTime();
        else timeState.setHistoricalTime(new Date(Date.now() - daysAgo * DAY_MS));
    }

    function renderFromSnapshot(snapshot) {
        label.textContent = snapshot.historical
            ? `${dateFormat.format(snapshot.date)} UTC (historical)`
            : 'Live';
        if (panel) panel.dataset.mode = snapshot.historical ? 'historical' : 'live';
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
