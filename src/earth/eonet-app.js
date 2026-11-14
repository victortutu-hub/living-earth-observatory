import { createEonetDataSource } from './eonet-data.js';
import { createEonetUi } from './eonet-ui.js';
import { createEonetWorkflow } from './eonet-workflow.js';

export function createEonetApp({
    apiUrl,
    state,
    officialCategories,
    officialCategoryLabels,
    latestGeometry,
    eventCategory,
    eventColor,
    eventDate,
    eventRecency,
    eventSortAge,
    recentBadge,
    editorialSelection,
    supplementalProviders,
    fallbackProviders,
    onSourceStateChange,
    getDataDay,
    onDeferredEventsApplied = () => {},
    updateStats,
    addMarkers,
    renderMissingGeometry,
    focusOnLonLat,
    setSelectedCinematic,
    clearSelectedCinematic,
    clearSelectionTrail,
    buildSelectionTrail,
    stopIssTracking,
    stopMoonTracking
}) {
    let workflow;

    const eventUi = createEonetUi({
        state,
        officialCategories,
        officialCategoryLabels,
        latestGeometry,
        eventCategory,
        eventColor,
        eventDate,
        eventRecency,
        eventSortAge,
        recentBadge,
        editorialSelection,
        onSelectEvent: id => workflow?.selectEvent(id)
    });

    const eonetData = createEonetDataSource({
        apiUrl,
        latestGeometry,
        eventCategory,
        supplementalProviders,
        fallbackProviders,
        onSourceStateChange,
        getDataDay,
        // FIRMS on a historical day arrives after EONET/USGS (LOT 9).
        onDeferredEvents: ({ day, events }) => {
            const applied = workflow?.appendDeferredEvents({ day, events, sourceProvider: 'NASA FIRMS' });
            onDeferredEventsApplied({ day, applied: Boolean(applied) });
        }
    });

    workflow = createEonetWorkflow({
        state,
        eonetData,
        latestGeometry,
        eventColor,
        eventRecency,
        updateStats: updateStats || eventUi.updateStats,
        addMarkers,
        renderTodayOnEarth: eventUi.renderTodayOnEarth,
        renderList: eventUi.renderList,
        renderMissingGeometry: renderMissingGeometry || eventUi.renderMissingGeometry,
        renderEventDetails: eventUi.renderEventDetails,
        renderClusterDetails: eventUi.renderClusterDetails,
        populateCategoryFilter: eventUi.populateCategoryFilter,
        focusOnLonLat,
        setSelectedCinematic,
        clearSelectedCinematic,
        clearSelectionTrail,
        buildSelectionTrail,
        stopIssTracking,
        stopMoonTracking
    });

    function dispose() {
        workflow.dispose?.();
        eonetData.dispose?.();
    }

    return {
        ...workflow,
        eventUi,
        eonetData,
        dispose
    };
}
