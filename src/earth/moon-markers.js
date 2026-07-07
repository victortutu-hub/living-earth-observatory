// Catalog static de repere lunare reale (situri de aselenizare Apollo,
// cratere si mari majore) - coordonate selenografice (longitudine Est
// pozitiva, IAU) din surse publice (NASA LPI, USGS Astrogeology). Nu e un
// feed live ca NASA EONET pentru Pamant - Luna nu are "evenimente" curente,
// deci lista e curata manual, similar catalogului de stele numite din
// star-field.js.
export const moonLandmarks = [
    {
        id: 'apollo11',
        name: 'Apollo 11 - Statio Tranquillitatis',
        lon: 23.47,
        lat: 0.67,
        type: 'Landing site',
        mission: 'Apollo 11',
        date: '1969-07-20',
        color: 0xffb347,
        description: 'Prima aselenizare umana - Neil Armstrong si Buzz Aldrin, pe campia bazaltica Mare Tranquillitatis.'
    },
    {
        id: 'apollo12',
        name: 'Apollo 12 - Oceanus Procellarum',
        lon: -23.42,
        lat: -3.01,
        type: 'Landing site',
        mission: 'Apollo 12',
        date: '1969-11-19',
        color: 0xffb347,
        description: 'Aselenizare de precizie langa sonda robotica Surveyor 3, in Oceanus Procellarum.'
    },
    {
        id: 'apollo14',
        name: 'Apollo 14 - Fra Mauro',
        lon: -17.47,
        lat: -3.65,
        type: 'Landing site',
        mission: 'Apollo 14',
        date: '1971-02-05',
        color: 0xffb347,
        description: 'Zona deluroasa Fra Mauro, ejecta a bazinului Mare Imbrium.'
    },
    {
        id: 'apollo15',
        name: 'Apollo 15 - Hadley Rille',
        lon: 3.63,
        lat: 26.13,
        type: 'Landing site',
        mission: 'Apollo 15',
        date: '1971-07-30',
        color: 0xffb347,
        description: 'Prima misiune cu rover lunar, langa canionul sinuos Hadley Rille si Muntii Apenini.'
    },
    {
        id: 'apollo16',
        name: 'Apollo 16 - Descartes Highlands',
        lon: 15.51,
        lat: -8.97,
        type: 'Landing site',
        mission: 'Apollo 16',
        date: '1972-04-21',
        color: 0xffb347,
        description: 'Singura aselenizare in podisurile lunare inalte, nu pe o mare bazaltica.'
    },
    {
        id: 'apollo17',
        name: 'Apollo 17 - Taurus-Littrow',
        lon: 30.77,
        lat: 20.19,
        type: 'Landing site',
        mission: 'Apollo 17',
        date: '1972-12-11',
        color: 0xffb347,
        description: 'Ultima aselenizare umana pe Luna - Eugene Cernan si Harrison Schmitt (singurul geolog din program).'
    },
    {
        id: 'tycho',
        name: 'Craterul Tycho',
        lon: -11.36,
        lat: -43.3,
        type: 'Impact crater',
        color: 0x9fe7ff,
        description: 'Crater tanar (~108 milioane de ani), diametru ~85 km, cu sistemul de raze luminoase cel mai extins de pe Luna.'
    },
    {
        id: 'copernicus',
        name: 'Craterul Copernicus',
        lon: -20.08,
        lat: 9.62,
        type: 'Impact crater',
        color: 0x9fe7ff,
        description: 'Crater de referinta (~93 km, ~800 milioane de ani), cu terase interioare si varf central bine conservate.'
    },
    {
        id: 'aristarchus',
        name: 'Craterul Aristarchus',
        lon: -47.49,
        lat: 23.73,
        type: 'Impact crater / albedo anomaly',
        color: 0x9fe7ff,
        description: 'Cea mai stralucitoare formatiune mare de pe suprafata Lunii, vizibila cu ochiul liber prin earthshine.'
    },
    {
        id: 'mare-imbrium',
        name: 'Mare Imbrium',
        lon: -17.0,
        lat: 32.8,
        type: 'Impact basin / mare',
        color: 0x6fa8dc,
        description: 'Unul dintre cele mai mari bazine de impact lunare (~3.9 miliarde de ani), umplut ulterior cu lava bazaltica.'
    },
    {
        id: 'mare-crisium',
        name: 'Mare Crisium',
        lon: 59.1,
        lat: 17.0,
        type: 'Impact basin / mare',
        color: 0x6fa8dc,
        description: 'Bazin circular izolat, usor de recunoscut pe fata vizibila, langa limbul estic.'
    },
    {
        id: 'shackleton',
        name: 'Craterul Shackleton',
        lon: 0.0,
        lat: -89.9,
        type: 'Polar crater',
        color: 0xd7e8ff,
        description: 'Crater la polul sud, cu interiorul permanent umbrit - date LRO/LCROSS indica gheata de apa.'
    }
];

// Raza sferei Lunii (moon-system.js: SphereGeometry(0.5, ...)) - trebuie sa
// ramana in sincron cu acea valoare, altfel marker-ele plutesc deasupra sau
// se scufunda sub suprafata reala.
const MOON_MESH_RADIUS = 0.5;
const MARKER_SURFACE_OFFSET = 1.012;

export function createMoonMarkers({ THREE, moon, localDirForSelenographic }) {
    const group = new THREE.Group();
    group.name = 'moon-markers';
    group.visible = false;
    moon.add(group);

    const markerGeometry = new THREE.SphereGeometry(0.028, 12, 10);
    const haloGeometry = new THREE.SphereGeometry(0.05, 10, 8);

    const markerMeshes = moonLandmarks.map(landmark => {
        const dir = localDirForSelenographic(THREE, landmark.lon, landmark.lat, new THREE.Vector3());
        const position = dir.clone().multiplyScalar(MOON_MESH_RADIUS * MARKER_SURFACE_OFFSET);

        const halo = new THREE.Mesh(haloGeometry, new THREE.MeshBasicMaterial({
            color: landmark.color,
            transparent: true,
            opacity: 0.22,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));
        halo.position.copy(position);

        const dot = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
            color: landmark.color,
            transparent: true,
            opacity: 0.92,
            depthWrite: false
        }));
        dot.position.copy(position);
        dot.userData.specialId = `moonMarker:${landmark.id}`;
        dot.userData.moonLandmark = landmark;
        dot.userData.moonMarkerDir = dir;

        group.add(halo, dot);
        return dot;
    });

    function updateMoonMarkersButton(enabled) {
        const button = document.getElementById('moonMarkersBtn');
        if (button) button.textContent = `Moon markers: ${enabled ? 'on' : 'off'}`;
    }

    function setEnabled(enabled) {
        group.visible = Boolean(enabled);
        updateMoonMarkersButton(group.visible);
    }

    function toggle() {
        setEnabled(!group.visible);
        return group.visible;
    }

    function findLandmark(specialId) {
        if (!specialId?.startsWith('moonMarker:')) return null;
        const id = specialId.slice('moonMarker:'.length);
        return moonLandmarks.find(l => l.id === id) || null;
    }

    function meshForLandmarkId(id) {
        return markerMeshes.find(mesh => mesh.userData.moonLandmark.id === id) || null;
    }

    return {
        group,
        markerMeshes,
        setEnabled,
        toggle,
        findLandmark,
        meshForLandmarkId
    };
}
