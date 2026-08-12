export function createGeoUtils(THREE) {
    function lonLatToVec3(lon, lat, radius = 2.14, target = new THREE.Vector3()) {
        const phi = THREE.MathUtils.degToRad(90 - lat);
        const theta = THREE.MathUtils.degToRad(lon + 180);
        return target.set(
            -radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
        );
    }

    // Inversa este pastrata langa transformarea directa: coordonatele vin din
    // feed-uri ca lon/lat, in timp ce picking-ul si layerele 3D lucreaza cu
    // vectori. Contractul explicit previne regresia clasica lat/lon inversat.
    function vec3ToLonLat(vector) {
        const x = Number(vector?.x);
        const y = Number(vector?.y);
        const z = Number(vector?.z);
        const radius = Math.hypot(x, y, z);
        if (!Number.isFinite(radius) || radius === 0) {
            throw new TypeError('vec3ToLonLat requires a finite, non-zero vector.');
        }
        const lat = Math.asin(Math.max(-1, Math.min(1, y / radius))) * 180 / Math.PI;
        const rawLon = Math.atan2(z, -x) * 180 / Math.PI - 180;
        const lon = ((rawLon + 180) % 360 + 360) % 360 - 180;
        return { lon, lat };
    }

    return { lonLatToVec3, vec3ToLonLat };
}
