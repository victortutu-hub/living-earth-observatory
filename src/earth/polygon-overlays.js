function stripClosingPoint(ring) {
    if (ring.length < 2) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
        return ring.slice(0, -1);
    }
    return ring;
}

function ringCentroid(ring) {
    let lon = 0;
    let lat = 0;
    for (const point of ring) {
        lon += point[0];
        lat += point[1];
    }
    return { lon: lon / ring.length, lat: lat / ring.length };
}

function ringRadiusScale(ring, centroid) {
    let maxDistance = 0;
    for (const [lon, lat] of ring) {
        const dLon = (lon - centroid.lon) * Math.cos(centroid.lat * Math.PI / 180);
        const dLat = lat - centroid.lat;
        maxDistance = Math.max(maxDistance, Math.hypot(dLon, dLat));
    }
    return Math.min(2.7, Math.max(1.1, 0.75 + maxDistance * 0.055));
}

function isIcebergLike(event, category) {
    return category === 'seaLakeIce' || /iceberg|ice shelf|sea ice/i.test(event.title || '');
}

export function buildEventPolygonOverlays({
    THREE,
    earcut,
    event,
    rings,
    color,
    category,
    recency = 0,
    clusterWeight = 1,
    lonLatToVec3
}) {
    if (!Array.isArray(rings) || !rings.length || !earcut) return [];

    const cleanRings = rings.map(stripClosingPoint).filter(ring => ring.length >= 3);
    if (!cleanRings.length) return [];

    const flat = [];
    const holes = [];
    const points = [];
    cleanRings.forEach((ring, ringIndex) => {
        if (ringIndex > 0) holes.push(points.length);
        for (const [lon, lat] of ring) {
            flat.push(lon, lat);
            points.push([lon, lat]);
        }
    });

    const triangles = earcut(flat, holes, 2);
    if (!triangles.length) return [];

    const overlays = [];
    const baseColor = new THREE.Color(color);
    const amber = new THREE.Color(0xffb347);
    const positions = new Float32Array(points.length * 3);
    points.forEach(([lon, lat], index) => {
        const p = lonLatToVec3(lon, lat, 2.052);
        positions[index * 3] = p.x;
        positions[index * 3 + 1] = p.y;
        positions[index * 3 + 2] = p.z;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(triangles);
    geometry.computeVertexNormals();

    const surface = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
            color: baseColor.clone().lerp(amber, isIcebergLike(event, category) ? 0.62 : 0.18),
            transparent: true,
            opacity: isIcebergLike(event, category) ? 0.16 : 0.11,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        })
    );
    surface.userData.kind = 'eventPolygonSurface';
    surface.userData.eventId = event.id;
    surface.userData.recency = recency;
    surface.userData.baseOpacity = surface.material.opacity;
    overlays.push(surface);

    const outerRing = cleanRings[0];
    const centroid = ringCentroid(outerRing);
    const anchor = lonLatToVec3(centroid.lon, centroid.lat, 2.062);
    const radiusScale = ringRadiusScale(outerRing, centroid);
    const ringRadius = 0.105 + Math.min(0.13, clusterWeight * 0.02);
    const temporalRing = new THREE.Mesh(
        new THREE.RingGeometry(ringRadius, ringRadius + 0.018, 72),
        new THREE.MeshBasicMaterial({
            color: amber,
            transparent: true,
            opacity: isIcebergLike(event, category) ? 0.58 : 0.34,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        })
    );
    temporalRing.position.copy(anchor);
    temporalRing.lookAt(0, 0, 0);
    temporalRing.scale.setScalar(radiusScale);
    temporalRing.userData.kind = 'temporalAmberRing';
    temporalRing.userData.eventId = event.id;
    temporalRing.userData.lon = centroid.lon;
    temporalRing.userData.lat = centroid.lat;
    temporalRing.userData.recency = recency;
    temporalRing.userData.phase = Math.random();
    temporalRing.userData.baseScale = radiusScale;
    temporalRing.userData.baseOpacity = temporalRing.material.opacity;
    overlays.push(temporalRing);

    return overlays;
}
