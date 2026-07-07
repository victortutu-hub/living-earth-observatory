export function createSceneInteraction({
    THREE,
    renderer,
    camera,
    markerGroup,
    extraObjects = [],
    onSelectCluster,
    onSelectEvent,
    onSelectExtra,
    dragThreshold = 5
}) {
    const interaction = { downX: 0, downY: 0, dragThreshold };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    raycaster.params.Points.threshold = 0.045;

    function setPointerFromClient(clientX, clientY) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    }

    function pickSceneAt(clientX, clientY) {
        setPointerFromClient(clientX, clientY);
        raycaster.setFromCamera(pointer, camera);
        return raycaster.intersectObjects(markerGroup.children, true)[0];
    }

    function markerHitsAt(clientX, clientY) {
        setPointerFromClient(clientX, clientY);
        raycaster.setFromCamera(pointer, camera);
        return raycaster.intersectObjects(markerGroup.children, true);
    }

    function hitUserData(hit) {
        if (!hit?.object) return null;
        if (hit.object.isInstancedMesh && Number.isInteger(hit.instanceId)) {
            return hit.object.userData.instances?.[hit.instanceId] || null;
        }
        if (hit.object.isPoints && Number.isInteger(hit.index)) {
            return hit.object.userData.instances?.[hit.index] || null;
        }
        let node = hit.object;
        while (node) {
            if (node.userData?.eventId || node.userData?.clusterId || node.userData?.specialId) {
                return node.userData;
            }
            node = node.parent;
        }
        return hit.object.userData || null;
    }

    function pickMarkerDataAt(clientX, clientY) {
        const hits = markerHitsAt(clientX, clientY);
        for (const hit of hits) {
            const data = hitUserData(hit);
            if (data?.clusterId || data?.eventId) return data;
        }
        return null;
    }

    function handlePointerDown(event) {
        interaction.downX = event.clientX;
        interaction.downY = event.clientY;
    }

    function handlePointerUp(event) {
        const dx = event.clientX - interaction.downX;
        const dy = event.clientY - interaction.downY;
        if (Math.hypot(dx, dy) > interaction.dragThreshold) return;

        const picked = pickMarkerDataAt(event.clientX, event.clientY);
        if (picked?.clusterId) {
            onSelectCluster?.(picked.clusterId);
            return;
        }
        if (picked?.eventId) {
            onSelectEvent?.(picked.eventId);
            return;
        }
        // Obiecte aditionale (Luna, ISS etc.) - cautate doar daca marker-ele n-au dat hit,
        // ca sa nu schimbam deloc comportamentul existent pentru evenimente EONET.
        if (extraObjects.length) {
            setPointerFromClient(event.clientX, event.clientY);
            raycaster.setFromCamera(pointer, camera);
            const extraHit = raycaster.intersectObjects(extraObjects, false)[0];
            const specialId = extraHit?.object?.userData?.specialId;
            if (specialId) onSelectExtra?.(specialId);
        }
    }

    function attach() {
        renderer.domElement.addEventListener('pointerdown', handlePointerDown);
        renderer.domElement.addEventListener('pointerup', handlePointerUp);
    }

    function detach() {
        renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
        renderer.domElement.removeEventListener('pointerup', handlePointerUp);
    }

    return {
        attach,
        detach,
        pickSceneAt,
        hitUserData,
        pickMarkerDataAt
    };
}
