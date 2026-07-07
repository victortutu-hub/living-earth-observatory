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

    return { lonLatToVec3 };
}
