import { createMarkerSystem } from './marker-system.js?v=markerPicking1';
import { createSceneInteraction } from './scene-interaction.js?v=markerPicking1';

export function createEventScene({
    THREE,
    state,
    earthGroup,
    renderer,
    camera,
    earcut,
    eventLonLat,
    eventCategory,
    eventColor,
    eventDate,
    eventAgeDays,
    eventRecency,
    eventMagnitudeScale,
    eventPolygonRings,
    lonLatToVec3
}) {
    const markerGroup = new THREE.Group();
    earthGroup.add(markerGroup);

    const trailGroup = new THREE.Group();
    earthGroup.add(trailGroup);

    const markerSystem = createMarkerSystem({
        THREE,
        state,
        markerGroup,
        trailGroup,
        earcut,
        eventLonLat,
        eventCategory,
        eventColor,
        eventDate,
        eventAgeDays,
        eventRecency,
        eventMagnitudeScale,
        eventPolygonRings,
        lonLatToVec3
    });

    let sceneInteraction = null;

    function attachInteraction({ onSelectCluster, onSelectEvent, extraObjects, onSelectExtra }) {
        sceneInteraction?.detach();
        sceneInteraction = createSceneInteraction({
            THREE,
            renderer,
            camera,
            markerGroup,
            extraObjects,
            onSelectCluster,
            onSelectEvent,
            onSelectExtra
        });
        sceneInteraction.attach();
        return sceneInteraction;
    }

    function dispose() {
        sceneInteraction?.detach();
        markerSystem.clearMarkers();
        markerSystem.clearSelectionTrail();
        earthGroup.remove(markerGroup);
        earthGroup.remove(trailGroup);
    }

    return {
        markerGroup,
        trailGroup,
        markerSystem,
        attachInteraction,
        dispose,
        addMarkers: markerSystem.addMarkers,
        clearSelectionTrail: markerSystem.clearSelectionTrail,
        buildSelectionTrail: markerSystem.buildSelectionTrail,
        updateMarkerAnimation: markerSystem.updateMarkerAnimation
    };
}
