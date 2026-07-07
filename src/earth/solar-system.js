export function createSolarSystem({
    THREE,
    scene,
    sunLight,
    lonLatToVec3,
    diagnosticIds = {
        romania: 'solarRomania',
        utc: 'solarUtc',
        lon: 'solarLon',
        lat: 'solarLat'
    }
}) {
    const ASTRONOMY_ENGINE_URL = 'https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/+esm';
    const SOLAR_DISTANCE = 15;
    const solarState = {
        utcLabel: '--:--',
        romaniaLabel: '--:--',
        subsolarLon: 0,
        subsolarLat: 0,
        source: 'approx'
    };
    let astronomyEngine = null;
    let astronomyLoadPromise = null;
    let astronomyLoadFailed = false;
    let astronomyObserver = null;

    const romaniaClockFormat = new Intl.DateTimeFormat('ro-RO', {
        timeZone: 'Europe/Bucharest',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const utcClockFormat = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const coolFill = new THREE.DirectionalLight(0x66d0ff, 0.28);
    const coolFillDirection = new THREE.Vector3();
    const coolFillBias = new THREE.Vector3(0, 0.16, 0.08);
    scene.add(coolFill);

    function formatSolarCoord(value, axis) {
        const dir = axis === 'lon' ? (value >= 0 ? 'E' : 'W') : (value >= 0 ? 'N' : 'S');
        return `${Math.abs(value).toFixed(1)}\u00B0${dir}`;
    }

    function updateSolarDiagnostic() {
        document.getElementById(diagnosticIds.romania).textContent = solarState.romaniaLabel;
        document.getElementById(diagnosticIds.utc).textContent = solarState.utcLabel;
        document.getElementById(diagnosticIds.lon).textContent = formatSolarCoord(solarState.subsolarLon, 'lon');
        document.getElementById(diagnosticIds.lat).textContent = formatSolarCoord(solarState.subsolarLat, 'lat');
        const panel = document.getElementById('solarPanel');
        if (panel) panel.dataset.source = solarState.source;
    }

    function isLeapYear(year) {
        return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    }

    function normalizeLongitude(degrees) {
        return ((degrees + 540) % 360) - 180;
    }

    function updateSolarClockLabels(now) {
        solarState.utcLabel = `${utcClockFormat.format(now)} UTC`;
        solarState.romaniaLabel = `${romaniaClockFormat.format(now)} RO`;
    }

    async function loadAstronomyEngine() {
        if (astronomyEngine || astronomyLoadFailed) return astronomyEngine;
        if (!astronomyLoadPromise) {
            astronomyLoadPromise = import(ASTRONOMY_ENGINE_URL)
                .then(module => {
                    astronomyEngine = module.default || module;
                    astronomyObserver = new astronomyEngine.Observer(0, 0, 0);
                    return astronomyEngine;
                })
                .catch(error => {
                    astronomyLoadFailed = true;
                    console.warn('[Solar] Astronomy Engine unavailable; using approximate solar position.', error);
                    return null;
                });
        }
        return astronomyLoadPromise;
    }

    function calcApproxSunPosition(now = new Date()) {
        const utcH = now.getUTCHours() + now.getUTCMinutes() / 60
            + now.getUTCSeconds() / 3600 + now.getUTCMilliseconds() / 3600000;
        const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
        const doy = Math.ceil((now - start) / 86400000);
        const daysInYear = isLeapYear(now.getUTCFullYear()) ? 366 : 365;
        const decl = -23.45 * Math.PI / 180 * Math.cos(2 * Math.PI * (doy + 10) / daysInYear);
        const subsolarLon = normalizeLongitude((12 - utcH) * 15);
        const subsolarLat = decl * 180 / Math.PI;
        updateSolarClockLabels(now);
        solarState.subsolarLon = subsolarLon;
        solarState.subsolarLat = subsolarLat;
        solarState.source = 'approx';
        return lonLatToVec3(subsolarLon, subsolarLat, SOLAR_DISTANCE);
    }

    function calcAstronomyEngineSunPosition(now, Astronomy) {
        const equatorial = Astronomy.Equator(Astronomy.Body.Sun, now, astronomyObserver, true, true);
        const siderealHours = Astronomy.SiderealTime(now);
        const subsolarLon = normalizeLongitude((equatorial.ra - siderealHours) * 15);
        const subsolarLat = equatorial.dec;
        updateSolarClockLabels(now);
        solarState.subsolarLon = subsolarLon;
        solarState.subsolarLat = subsolarLat;
        solarState.source = 'astronomy-engine';
        return lonLatToVec3(subsolarLon, subsolarLat, SOLAR_DISTANCE);
    }

    async function calcRealSunPosition() {
        const now = new Date();
        const Astronomy = await loadAstronomyEngine();
        if (!Astronomy) return calcApproxSunPosition(now);
        return calcAstronomyEngineSunPosition(now, Astronomy);
    }

    function updateCoolFillDirection() {
        coolFillDirection.copy(sunLight.position).normalize().multiplyScalar(-1).add(coolFillBias).normalize();
        coolFill.position.copy(coolFillDirection).multiplyScalar(12);
    }

    async function updateRealSunPosition() {
        sunLight.position.copy(await calcRealSunPosition());
        updateCoolFillDirection();
        updateSolarDiagnostic();
    }

    return {
        coolFill,
        solarState,
        calcApproxSunPosition,
        calcRealSunPosition,
        updateCoolFillDirection,
        updateRealSunPosition
    };
}
