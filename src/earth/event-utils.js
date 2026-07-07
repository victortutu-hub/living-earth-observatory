function polygonRingCentroid(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return null;
    let area = 0;
    let lonSum = 0;
    let latSum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[i + 1];
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        lonSum += (x0 + x1) * cross;
        latSum += (y0 + y1) * cross;
    }
    if (Math.abs(area) > 1e-6) return [lonSum / (3 * area), latSum / (3 * area)];
    const sample = ring.filter(point => Array.isArray(point) && point.length >= 2);
    if (!sample.length) return null;
    lonSum = 0;
    latSum = 0;
    for (const [lon, lat] of sample) {
        lonSum += lon;
        latSum += lat;
    }
    return [lonSum / sample.length, latSum / sample.length];
}

export function createEventUtils({ THREE, categoryColors, fallbackColor, futureDateToleranceMs }) {
    function latestGeometry(event) {
        const geoms = event.geometry || [];
        for (let i = geoms.length - 1; i >= 0; i--) {
            const g = geoms[i];
            if (g.type === 'Point' && Array.isArray(g.coordinates)) return g;
            if (g.type === 'Polygon' && Array.isArray(g.coordinates?.[0]?.[0])) {
                const centroid = polygonRingCentroid(g.coordinates[0]);
                if (centroid) return { ...g, coordinates: centroid };
            }
        }
        return null;
    }

    function eventCategory(event) {
        return event.categories?.[0]?.id || 'unknown';
    }

    function eventColor(event) {
        return categoryColors[eventCategory(event)] || fallbackColor;
    }

    function eventLonLat(event) {
        const geom = latestGeometry(event);
        if (!geom) return null;
        const [lon, lat] = geom.coordinates;
        return { lon: Number(lon), lat: Number(lat), geom };
    }

    function eventDate(event) {
        const raw = latestGeometry(event)?.date || event.geometry?.[0]?.date;
        const date = raw ? new Date(raw) : null;
        return date && Number.isFinite(date.getTime()) ? date : null;
    }

    function eventAgeDays(event) {
        const date = eventDate(event);
        if (!date) return Infinity;
        return (Date.now() - date.getTime()) / 86400000;
    }

    function eventHasFutureDate(event) {
        const date = eventDate(event);
        return Boolean(date && date.getTime() - Date.now() > futureDateToleranceMs);
    }

    function eventRecency(event) {
        const age = eventAgeDays(event);
        if (!Number.isFinite(age) || age < 0) return 0;
        return THREE.MathUtils.clamp(1 - age / 14, 0, 1);
    }

    function eventSortAge(event) {
        const age = eventAgeDays(event);
        if (!Number.isFinite(age) || age < 0) return Infinity;
        return age;
    }

    function eventMagnitudeScale(event) {
        const geom = latestGeometry(event);
        const magnitude = Number(geom?.magnitudeValue);
        if (!Number.isFinite(magnitude) || magnitude <= 0) return 1;
        const unit = String(geom?.magnitudeUnit || '').toLowerCase();
        const category = eventCategory(event);
        const isAreaLike = category === 'wildfires' || category === 'drought' || /acre|hectare|km|sq|ha/.test(unit);
        const logBoost = isAreaLike
            ? Math.log10(magnitude + 1) * 0.34
            : Math.log10(magnitude + 1) * 0.24;
        return 1 + THREE.MathUtils.clamp(logBoost, 0, 0.9);
    }

    function eventPolygonRings(event) {
        const geoms = event.geometry || [];
        for (let i = geoms.length - 1; i >= 0; i--) {
            const g = geoms[i];
            if (g.type === 'Polygon' && Array.isArray(g.coordinates?.[0]?.[0])) {
                return g.coordinates
                    .map(ring => ring
                        .filter(point => Array.isArray(point) && point.length >= 2)
                        .map(([lon, lat]) => [Number(lon), Number(lat)])
                        .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
                    )
                    .filter(ring => ring.length >= 3);
            }
        }
        return null;
    }

    function recentBadge(event) {
        const age = eventAgeDays(event);
        if (eventHasFutureDate(event)) return '<span class="badge recent">date anomaly</span>';
        if (event.sources?.some(source => source.id === 'USGS')) {
            if (age <= 2 / 24) return '<span class="badge live">live</span>';
            if (age <= 1) return '<span class="badge recent">today</span>';
            if (age <= 7) return '<span class="badge recent">recent</span>';
            return '';
        }
        if (age <= 1.25) return '<span class="badge live">live</span>';
        if (age <= 7) return '<span class="badge recent">recent</span>';
        return '';
    }

    return {
        latestGeometry,
        eventCategory,
        eventColor,
        eventLonLat,
        eventDate,
        eventAgeDays,
        eventHasFutureDate,
        eventRecency,
        eventSortAge,
        eventMagnitudeScale,
        recentBadge,
        eventPolygonRings
    };
}
