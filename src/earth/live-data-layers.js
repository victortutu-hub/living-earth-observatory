import { createUsgsEarthquakeProvider } from './usgs-earthquakes.js';
import { createFirmsWildfireProvider } from './firms-wildfires.js';

// Aurora a fost migrata la registry-ul de layere (layers/aurora.js, tip 'custom').
// Aici raman doar sursele inca bespoke: USGS quakes si NASA FIRMS.
export function createLiveDataLayers({
    THREE,
    state,
    earthGroup,
    lonLatToVec3,
    updateSeismicLayerStatus,
    updateFirmsLayerStatus
}) {
    const usgsEarthquakes = createUsgsEarthquakeProvider();
    const firmsWildfires = createFirmsWildfireProvider();

    function refreshUsgsStatus() {
        const status = usgsEarthquakes.getStatus();
        state.usgsQuakes = status.enabled;
        updateSeismicLayerStatus(status);
    }

    function refreshFirmsStatus() {
        const status = firmsWildfires.getStatus();
        state.firmsWildfires = status.enabled;
        updateFirmsLayerStatus(status);
    }

    async function toggleFirmsWildfires(refreshEvents) {
        const nextEnabled = !state.firmsWildfires;
        state.firmsWildfires = nextEnabled;
        firmsWildfires.setEnabled(nextEnabled);
        updateFirmsLayerStatus({
            enabled: nextEnabled,
            loading: nextEnabled,
            state: nextEnabled ? 'refreshing' : 'off',
            message: nextEnabled ? 'NASA FIRMS: loading wildfire hotspots...' : 'NASA FIRMS: off'
        });
        await refreshEvents?.();
        refreshFirmsStatus();
    }

    function setFirmsWildfiresEnabled(enabled) {
        state.firmsWildfires = Boolean(enabled);
        firmsWildfires.setEnabled(state.firmsWildfires);
        refreshFirmsStatus();
    }

    async function toggleUsgsQuakes(refreshEvents) {
        const nextEnabled = !state.usgsQuakes;
        state.usgsQuakes = nextEnabled;
        usgsEarthquakes.setEnabled(nextEnabled);
        updateSeismicLayerStatus({
            enabled: nextEnabled,
            loading: nextEnabled,
            state: nextEnabled ? 'refreshing' : 'off',
            message: nextEnabled ? 'USGS quakes: loading selected time window...' : 'USGS quakes: off'
        });
        await refreshEvents?.();
        refreshUsgsStatus();
    }

    // USGS/FIRMS nu au animatie per-frame. Hook-ul re-randeaza doar statusul,
    // ca varsta relativa ("data 12 min ago") sa nu ramana inghetata.
    const STATUS_REFRESH_SECONDS = 30;
    let lastStatusRefresh = null;

    function update(t) {
        if (!Number.isFinite(t)) return;
        if (lastStatusRefresh !== null && t - lastStatusRefresh < STATUS_REFRESH_SECONDS) return;
        lastStatusRefresh = t;
        if (state.usgsQuakes) refreshUsgsStatus();
        if (state.firmsWildfires) refreshFirmsStatus();
    }

    function dispose() {
        usgsEarthquakes.dispose?.();
        firmsWildfires.dispose?.();
    }

    return {
        supplementalProviders: [usgsEarthquakes, firmsWildfires],
        toggleUsgsQuakes,
        toggleFirmsWildfires,
        setFirmsWildfiresEnabled,
        refreshUsgsStatus,
        refreshFirmsStatus,
        update,
        dispose
    };
}
