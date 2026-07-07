import { createUsgsEarthquakeProvider } from './usgs-earthquakes.js?v=markerPicking1';
import { createNoaaAuroraLayer } from './noaa-aurora-layer.js';
import { createFirmsWildfireProvider } from './firms-wildfires.js?v=firms4';

export function createLiveDataLayers({
    THREE,
    state,
    earthGroup,
    lonLatToVec3,
    updateSeismicLayerStatus,
    updateAuroraLayerStatus,
    updateFirmsLayerStatus
}) {
    const usgsEarthquakes = createUsgsEarthquakeProvider();
    const firmsWildfires = createFirmsWildfireProvider();
    const auroraLayer = createNoaaAuroraLayer({
        THREE,
        earthGroup,
        lonLatToVec3
    });

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

    function refreshAuroraStatus() {
        const status = auroraLayer.getStatus();
        state.auroraLayer = status.enabled;
        updateAuroraLayerStatus(status);
    }

    async function toggleAuroraLayer() {
        const nextEnabled = !state.auroraLayer;
        state.auroraLayer = nextEnabled;
        updateAuroraLayerStatus({
            enabled: nextEnabled,
            loading: nextEnabled,
            state: nextEnabled ? 'refreshing' : 'off',
            message: nextEnabled ? 'Aurora: loading NOAA OVATION...' : 'Aurora: NOAA OVATION off'
        });
        await auroraLayer.setEnabled(nextEnabled);
        refreshAuroraStatus();
    }

    function update(t) {
        auroraLayer.update(t);
    }

    function dispose() {
        auroraLayer.dispose();
    }

    return {
        supplementalProviders: [usgsEarthquakes, firmsWildfires],
        toggleUsgsQuakes,
        toggleFirmsWildfires,
        setFirmsWildfiresEnabled,
        toggleAuroraLayer,
        refreshUsgsStatus,
        refreshFirmsStatus,
        refreshAuroraStatus,
        update,
        dispose
    };
}
