import { createEonetDataSource } from './eonet-data.js?v=polyFix2';
import { createEonetUi } from './eonet-ui.js?v=markerPicking1';
import { createEonetWorkflow } from './eonet-workflow.js?v=todayHighlights3';

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
        onSourceStateChange
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
