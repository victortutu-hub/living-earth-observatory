// Geographic visibility is separate from whether an event exists in a feed.
export function smoothstep(edge0, edge1, value) {
    const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

export function horizonFacingThreshold({ earthRadius = 2, markerRadius = 2.13, cameraDistance }) {
    if (!(earthRadius > 0 && markerRadius > earthRadius && cameraDistance > earthRadius)) return 0;
    const a = markerRadius * markerRadius * cameraDistance * cameraDistance;
    const b = -2 * earthRadius * earthRadius * markerRadius * cameraDistance;
    const c = earthRadius * earthRadius * (markerRadius * markerRadius + cameraDistance * cameraDistance) - a;
    return (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
}

export function markerHorizonWeight({ markerDirection, cameraDirection, earthRadius = 2, markerRadius = 2.13, cameraDistance, transition = 0.11 }) {
    const facing = markerDirection.x * cameraDirection.x + markerDirection.y * cameraDirection.y + markerDirection.z * cameraDirection.z;
    const horizon = horizonFacingThreshold({ earthRadius, markerRadius, cameraDistance });
    return smoothstep(horizon - transition, horizon + transition, facing);
}
