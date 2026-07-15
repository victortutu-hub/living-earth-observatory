export function createEonetWorkflow({
    state,
    eonetData,
    latestGeometry,
    eventColor,
    eventRecency,
    updateStats,
    addMarkers,
    renderTodayOnEarth,
    renderList,
    renderMissingGeometry,
    renderEventDetails,
    renderClusterDetails,
    populateCategoryFilter,
    focusOnLonLat,
    setSelectedCinematic,
    clearSelectedCinematic,
    clearSelectionTrail,
    buildSelectionTrail,
    stopIssTracking,
    stopMoonTracking,
    loadingId = 'loading'
}) {
    let disposed = false;
    let loadGeneration = 0;

    function selectEvent(id) {
        stopIssTracking?.();
        stopMoonTracking?.();
        state.selectedId = id;
        const event = state.events.find(item => item.id === id);
        if (!event) return;
        const geom = latestGeometry(event);
        if (!geom) {
            renderMissingGeometry(event);
            return;
        }
        const [lon, lat] = geom.coordinates;
        renderEventDetails(event, geom);
        focusOnLonLat(lon, lat, 3.72);
        setSelectedCinematic(lon, lat, 3.72);
        buildSelectionTrail(lon, lat, eventColor(event), eventRecency(event));
        renderTodayOnEarth(state.filtered);
        renderList(state.filtered);
    }

    function selectCluster(clusterId) {
        stopIssTracking?.();
        stopMoonTracking?.();
        const cluster = state.clusters.find(item => item.id === clusterId);
        if (!cluster) return selectEvent(clusterId);
        if (cluster.count === 1) return selectEvent(cluster.primary.id);
        state.selectedId = cluster.primary.id;
        renderClusterDetails(cluster);
        focusOnLonLat(cluster.lon, cluster.lat, 3.92);
        setSelectedCinematic(cluster.lon, cluster.lat, 3.92);
        buildSelectionTrail(cluster.lon, cluster.lat, eventColor(cluster.primary), cluster.recency);
        renderTodayOnEarth(state.filtered);
        renderList(state.filtered);
    }

    function deselectAll() {
        stopIssTracking?.();
        stopMoonTracking?.();
        state.selectedId = null;
        clearSelectedCinematic();
        clearSelectionTrail();
        renderTodayOnEarth(state.filtered);
        renderList(state.filtered);
    }

    function applyFilter() {
        const filters = eonetData.readFilters();
        state.filtered = eonetData.filterEvents(state.events, filters);
        if (state.selectedId && !state.filtered.some(event => event.id === state.selectedId)) {
            state.selectedId = null;
            clearSelectedCinematic();
            clearSelectionTrail();
        }
        updateStats(state.filtered);
        renderTodayOnEarth(state.filtered);
        addMarkers(state.filtered);
        renderList(state.filtered);
    }

    async function loadEvents({ silent = false } = {}) {
        if (disposed) return;
        const generation = ++loadGeneration;
        const loading = document.getElementById(loadingId);
        if (!silent && loading) loading.style.display = 'grid';
        try {
            const events = await eonetData.fetchEvents();
            if (disposed || generation !== loadGeneration) return;
            state.events = events;
            populateCategoryFilter(state.events);
            applyFilter();
            if (!silent && loading) loading.style.display = 'none';
        } catch (err) {
            if (disposed || generation !== loadGeneration || err?.name === 'AbortError') return;
            if (!silent && loading) loading.textContent = eonetData.formatLoadError(err);
            if (silent) throw err;
        }
    }

    function dispose() {
        disposed = true;
        loadGeneration += 1;
    }

    return {
        selectEvent,
        selectCluster,
        deselectAll,
        applyFilter,
        loadEvents,
        dispose
    };
}
