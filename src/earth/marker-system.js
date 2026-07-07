import { buildEventPolygonOverlays } from './polygon-overlays.js';

function disposeObject3D(node) {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach(mat => mat.dispose?.());
    else node.material?.dispose?.();
}

function depthColor(THREE, depthKm) {
    const shallow = new THREE.Color(0x8ff7ff);
    const middle = new THREE.Color(0x57a6ff);
    const deep = new THREE.Color(0xb58cff);
    const clamped = Math.max(0, Math.min(700, Number(depthKm) || 0));
    if (clamped < 70) return shallow.lerp(middle, clamped / 70);
    return middle.lerp(deep, Math.min(1, (clamped - 70) / 430));
}

export function createMarkerSystem({
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
}) {
    const instancedMatrix = new THREE.Matrix4();
    const instancedQuaternion = new THREE.Quaternion();
    const instancedScale = new THREE.Vector3();
    const instancedColor = new THREE.Color();
    const white = new THREE.Color(0xffffff);
    const useInstancedMarkers = false;
    const useUsgsPointLayer = true;

    function buildClusters(events) {
        const grid = new Map();
        for (const event of events) {
            const ll = eventLonLat(event);
            if (!ll || !Number.isFinite(ll.lon) || !Number.isFinite(ll.lat)) continue;
            const category = eventCategory(event);
            const cell = Math.max(3, Math.min(9, 7 - Math.floor(events.length / 70)));
            const key = `${category}:${Math.round(ll.lat / cell)}:${Math.round(ll.lon / cell)}`;
            if (!grid.has(key)) grid.set(key, { events: [], lonSum: 0, latSum: 0, category });
            const cluster = grid.get(key);
            cluster.events.push(event);
            cluster.lonSum += ll.lon;
            cluster.latSum += ll.lat;
        }
        return [...grid.values()].map(cluster => {
            const count = cluster.events.length;
            const lon = cluster.lonSum / count;
            const lat = cluster.latSum / count;
            const primary = cluster.events[0];
            let newestDate = null;
            let recency = 0;
            let recentCount = 0;
            for (const event of cluster.events) {
                const date = eventDate(event);
                if (date && (!newestDate || date > newestDate)) newestDate = date;
                recency = Math.max(recency, eventRecency(event));
                const age = eventAgeDays(event);
                if (age >= 0 && age <= 7) recentCount++;
            }
            return {
                ...cluster,
                count,
                lon,
                lat,
                primary,
                newestDate,
                recency,
                recentCount,
                id: count > 1 ? `cluster:${primary.id}` : primary.id
            };
        });
    }

    function updateRecentRingTargets() {
        state.recentRingIds = state.clusters
            .filter(cluster => cluster.recency > 0.2)
            .sort((a, b) => {
                const dateA = a.newestDate ? a.newestDate.getTime() : 0;
                const dateB = b.newestDate ? b.newestDate.getTime() : 0;
                if (dateB !== dateA) return dateB - dateA;
                return b.recency - a.recency;
            })
            .slice(0, 3)
            .map(cluster => cluster.id);
    }

    function isTodayHighlightCluster(cluster) {
        const highlightIds = new Set(state.todayHighlightIds || []);
        return highlightIds.has(cluster.primary.id) || cluster.events?.some(event => highlightIds.has(event.id));
    }

    function shouldUseUsgsPointLayer(events) {
        return useUsgsPointLayer && state.usgsQuakes && events.filter(event => event.usgs).length >= 30;
    }

    function isBackgroundUsgsCluster(cluster, usgsPointLayerActive) {
        if (!usgsPointLayerActive || !cluster.primary?.usgs) return false;
        if (state.recentRingIds.includes(cluster.id)) return false;
        if (isTodayHighlightCluster(cluster)) return false;
        if (cluster.primary.id === state.selectedId) return false;
        return cluster.events?.every(event => event.usgs);
    }

    function addUsgsPointLayer(events) {
        const usgsEvents = events.filter(event => event.usgs && eventLonLat(event));
        if (!usgsEvents.length) return;
        const positions = [];
        const colors = [];
        const sizes = [];
        const phases = [];
        const ages = [];
        const instances = [];
        const now = Date.now();

        for (const event of usgsEvents) {
            const ll = eventLonLat(event);
            const geom = event.geometry?.[0] || {};
            const magnitude = Number(geom.magnitudeValue) || 0;
            const depthKm = Number(geom.depthKm) || 0;
            const timestamp = new Date(geom.date).getTime();
            const ageHours = Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 36e5) : 24;
            const pos = lonLatToVec3(ll.lon, ll.lat, 2.108 + Math.min(0.03, magnitude * 0.004));
            const color = depthColor(THREE, depthKm);
            positions.push(pos.x, pos.y, pos.z);
            colors.push(color.r, color.g, color.b);
            sizes.push(4.5 + Math.pow(Math.max(0.5, magnitude), 1.25) * 2.35);
            phases.push(Math.random() * Math.PI * 2);
            ages.push(ageHours);
            instances.push({
                eventId: event.id,
                clusterId: event.id,
                clusterCount: 1,
                lon: ll.lon,
                lat: ll.lat,
                recency: eventRecency(event),
                kind: 'usgsPoint',
                sourceProvider: event.sourceProvider || 'USGS'
            });
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
        geometry.setAttribute('aAge', new THREE.Float32BufferAttribute(ages, 1));

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 0.44 },
                uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) }
            },
            vertexShader: `
                attribute float aSize;
                attribute float aPhase;
                attribute float aAge;
                varying vec3 vColor;
                varying float vAlpha;
                varying float vFacing;
                uniform float uTime;
                uniform float uPixelRatio;
                void main() {
                    vColor = color;
                    float pulse = 0.9 + 0.1 * sin(uTime * 2.4 + aPhase);
                    float freshness = 1.0 - clamp(aAge / 720.0, 0.0, 0.72);
                    vAlpha = freshness * (0.72 + 0.28 * pulse);
                    vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                    vec3 worldNormal = normalize(worldPos);
                    vec3 viewDir = normalize(cameraPosition - worldPos);
                    vFacing = smoothstep(-0.06, 0.28, dot(worldNormal, viewDir));
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = aSize * pulse * uPixelRatio * (210.0 / max(120.0, -mvPosition.z));
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                varying float vFacing;
                uniform float uOpacity;
                void main() {
                    vec2 p = gl_PointCoord - 0.5;
                    float d = length(p) * 2.0;
                    float core = smoothstep(0.26, 0.0, d);
                    float ring = smoothstep(0.86, 0.52, d) * smoothstep(0.28, 0.52, d);
                    float halo = smoothstep(1.0, 0.24, d) * 0.055;
                    float alpha = (core * 0.85 + ring * 0.18 + halo) * vAlpha * vFacing * uOpacity;
                    if (alpha < 0.018) discard;
                    gl_FragColor = vec4(vColor, alpha);
                }
            `
        });

        const points = new THREE.Points(geometry, material);
        points.name = 'usgs-point-layer';
        points.userData.kind = 'usgsPointLayer';
        points.userData.instances = instances;
        points.frustumCulled = false;
        points.renderOrder = 78;
        markerGroup.add(points);
    }

    function clearMarkers() {
        markerGroup.children.forEach(disposeObject3D);
        markerGroup.clear();
    }

    function clearSelectionTrail() {
        trailGroup.children.forEach(disposeObject3D);
        trailGroup.clear();
    }

    function buildSelectionTrail(lon, lat, colorValue) {
        clearSelectionTrail();
        const color = new THREE.Color(colorValue);
        const anchor = lonLatToVec3(lon, lat, 2.045);
        const locatorRing = new THREE.Mesh(
            new THREE.RingGeometry(0.018, 0.024, 48),
            new THREE.MeshBasicMaterial({
                color: color.clone().lerp(new THREE.Color(0xffffff), 0.28),
                transparent: true,
                opacity: 0.72,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            })
        );
        locatorRing.position.copy(anchor);
        locatorRing.lookAt(0, 0, 0);
        locatorRing.userData.kind = 'selectedLocator';
        locatorRing.userData.baseOpacity = 0.72;
        locatorRing.userData.baseScale = 1;
        locatorRing.userData.phase = Math.random();
        trailGroup.add(locatorRing);
    }

    function addMarkers(events) {
        clearMarkers();
        state.clusters = buildClusters(events);
        updateRecentRingTargets();
        if (!state.clusters.length) return;
        const usgsPointLayerActive = shouldUseUsgsPointLayer(events);
        if (usgsPointLayerActive) addUsgsPointLayer(events);
        if (!useInstancedMarkers) {
            addLegacyMarkers(usgsPointLayerActive);
            return;
        }
        const markerGeometry = new THREE.SphereGeometry(0.023, 18, 12);
        const glowGeometry = new THREE.SphereGeometry(0.048, 22, 14);
        const markerMaterial = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.84,
            vertexColors: true,
            depthWrite: false
        });
        const glowMaterial = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.2,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const markerInstances = new THREE.InstancedMesh(markerGeometry, markerMaterial, state.clusters.length);
        const glowInstances = new THREE.InstancedMesh(glowGeometry, glowMaterial, state.clusters.length);
        markerInstances.frustumCulled = false;
        glowInstances.frustumCulled = false;
        markerInstances.renderOrder = 82;
        glowInstances.renderOrder = 81;
        markerInstances.userData.kind = 'instancedMarkerLayer';
        markerInstances.userData.instances = [];
        glowInstances.userData.kind = 'instancedGlowLayer';
        glowInstances.userData.instances = [];
        markerInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        glowInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        for (const cluster of state.clusters) {
            const event = cluster.primary;
            const color = new THREE.Color(eventColor(event));
            const pos = lonLatToVec3(cluster.lon, cluster.lat);
            const clusterWeight = Math.log2(cluster.count + 1);
            const magnitudeScale = eventMagnitudeScale(event);
            const shouldRing = state.recentRingIds.includes(cluster.id) || isTodayHighlightCluster(cluster) || cluster.primary.id === state.selectedId;
            if (isBackgroundUsgsCluster(cluster, usgsPointLayerActive)) continue;
            const polygonOverlays = buildEventPolygonOverlays({
                THREE,
                earcut,
                event,
                rings: eventPolygonRings(event),
                color,
                category: eventCategory(event),
                recency: cluster.recency,
                clusterWeight,
                lonLatToVec3
            });
            polygonOverlays.forEach(overlay => markerGroup.add(overlay));

            const isUsgs = Boolean(event.usgs);
            const markerScale = isUsgs
                ? Math.min(0.92, magnitudeScale * (1 + cluster.recency * 0.06))
                : Math.min(1.55, magnitudeScale * (1 + clusterWeight * 0.08) * (1 + cluster.recency * 0.12));
            const phase = Math.random();
            const instanceIndex = markerInstances.userData.instances.length;
            const instanceData = {
                eventId: event.id,
                clusterId: cluster.id,
                clusterCount: cluster.count,
                lon: cluster.lon,
                lat: cluster.lat,
                recency: cluster.recency,
                phase,
                baseScale: markerScale,
                baseOpacity: isUsgs ? 0.62 + cluster.recency * 0.12 : 0.74 + cluster.recency * 0.2,
                color,
                position: pos.clone(),
                glowPosition: pos.clone().multiplyScalar(1.004),
                markerRadiusScale: isUsgs ? 0.74 : cluster.count > 1 ? 1.17 : 1,
                glowRadiusScale: isUsgs ? 0.88 : cluster.count > 1 ? 1.5 : 1
            };
            markerInstances.userData.instances.push(instanceData);
            glowInstances.userData.instances.push({
                ...instanceData,
                phase: phase + 0.28,
                baseOpacity: isUsgs ? 0.045 + cluster.recency * 0.055 : (cluster.count > 1 ? 0.2 : 0.12) + cluster.recency * 0.16
            });
            instancedScale.setScalar(markerScale * instanceData.markerRadiusScale);
            instancedMatrix.compose(instanceData.position, instancedQuaternion, instancedScale);
            markerInstances.setMatrixAt(instanceIndex, instancedMatrix);
            markerInstances.setColorAt(instanceIndex, color);
            instancedScale.setScalar(markerScale * instanceData.glowRadiusScale);
            instancedMatrix.compose(instanceData.glowPosition, instancedQuaternion, instancedScale);
            glowInstances.setMatrixAt(instanceIndex, instancedMatrix);
            glowInstances.setColorAt(instanceIndex, color.clone().lerp(white, 0.16));

            if (shouldRing) {
                const ringRadius = isUsgs
                    ? 0.042 + Math.min(0.028, clusterWeight * 0.008) + cluster.recency * 0.01
                    : 0.07 + Math.min(0.08, clusterWeight * 0.018) + cluster.recency * 0.018;
                const ring = new THREE.Mesh(
                    new THREE.RingGeometry(ringRadius, ringRadius + (isUsgs ? 0.006 : 0.012), 56),
                    new THREE.MeshBasicMaterial({
                        color,
                        transparent: true,
                        opacity: isUsgs ? 0.16 + cluster.recency * 0.14 : 0.28 + cluster.recency * 0.32,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                        side: THREE.DoubleSide
                    })
                );
                ring.position.copy(pos.clone().multiplyScalar(1.006));
                ring.lookAt(0, 0, 0);
                ring.userData.kind = 'pulseRing';
                ring.userData.eventId = event.id;
                ring.userData.clusterId = cluster.id;
                ring.userData.clusterCount = cluster.count;
                ring.userData.lon = cluster.lon;
                ring.userData.lat = cluster.lat;
                ring.userData.recency = cluster.recency;
                ring.userData.phase = Math.random();
                ring.userData.baseScale = isUsgs ? 0.82 + clusterWeight * 0.055 : 1 + clusterWeight * 0.18;
                ring.userData.baseOpacity = isUsgs ? 0.16 + cluster.recency * 0.14 : 0.28 + cluster.recency * 0.32;
                ring.userData.isRecentRing = state.recentRingIds.includes(cluster.id);
                ring.userData.isTodayHighlight = isTodayHighlightCluster(cluster);
                ring.userData.isUsgsRing = isUsgs;
                markerGroup.add(ring);

                if (!isUsgs && cluster.recency > 0.65 && state.recentRingIds.includes(cluster.id)) {
                    const echo = ring.clone();
                    echo.material = ring.material.clone();
                    echo.userData = {
                        ...ring.userData,
                        phase: ring.userData.phase + 0.5,
                        baseOpacity: ring.userData.baseOpacity * 0.58
                    };
                    markerGroup.add(echo);
                }
            }
        }
        markerInstances.instanceMatrix.needsUpdate = true;
        glowInstances.instanceMatrix.needsUpdate = true;
        if (markerInstances.instanceColor) markerInstances.instanceColor.needsUpdate = true;
        if (glowInstances.instanceColor) glowInstances.instanceColor.needsUpdate = true;
        markerInstances.computeBoundingSphere();
        glowInstances.computeBoundingSphere();
        markerGroup.add(markerInstances);
        markerGroup.add(glowInstances);
    }

    function addLegacyMarkers(usgsPointLayerActive = false) {
        for (const cluster of state.clusters) {
            const event = cluster.primary;
            const color = new THREE.Color(eventColor(event));
            const pos = lonLatToVec3(cluster.lon, cluster.lat);
            const clusterWeight = Math.log2(cluster.count + 1);
            const magnitudeScale = eventMagnitudeScale(event);
            const shouldRing = state.recentRingIds.includes(cluster.id) || isTodayHighlightCluster(cluster) || cluster.primary.id === state.selectedId;
            if (isBackgroundUsgsCluster(cluster, usgsPointLayerActive)) continue;
            const polygonOverlays = buildEventPolygonOverlays({
                THREE,
                earcut,
                event,
                rings: eventPolygonRings(event),
                color,
                category: eventCategory(event),
                recency: cluster.recency,
                clusterWeight,
                lonLatToVec3
            });
            polygonOverlays.forEach(overlay => markerGroup.add(overlay));

            const isUsgs = Boolean(event.usgs);
            const markerScale = isUsgs
                ? Math.min(0.92, magnitudeScale * (1 + cluster.recency * 0.06))
                : Math.min(1.55, magnitudeScale * (1 + clusterWeight * 0.08) * (1 + cluster.recency * 0.12));
            const marker = new THREE.Mesh(
                new THREE.SphereGeometry(isUsgs ? 0.017 : cluster.count > 1 ? 0.027 : 0.023, 18, 12),
                new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: isUsgs ? 0.62 + cluster.recency * 0.12 : 0.74 + cluster.recency * 0.2
                })
            );
            marker.position.copy(pos);
            marker.userData.eventId = event.id;
            marker.userData.clusterId = cluster.id;
            marker.userData.clusterCount = cluster.count;
            marker.userData.lon = cluster.lon;
            marker.userData.lat = cluster.lat;
            marker.userData.recency = cluster.recency;
            marker.userData.phase = Math.random();
            marker.userData.baseScale = markerScale;
            marker.userData.baseOpacity = isUsgs ? 0.62 + cluster.recency * 0.12 : 0.74 + cluster.recency * 0.2;
            marker.scale.setScalar(marker.userData.baseScale);
            marker.lookAt(0, 0, 0);
            markerGroup.add(marker);

            const glow = new THREE.Mesh(
                new THREE.SphereGeometry(isUsgs ? 0.034 : cluster.count > 1 ? 0.072 : 0.048, 22, 14),
                new THREE.MeshBasicMaterial({
                    color,
                    transparent: true,
                    opacity: isUsgs ? 0.045 + cluster.recency * 0.055 : (cluster.count > 1 ? 0.2 : 0.12) + cluster.recency * 0.16,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                })
            );
            glow.position.copy(pos.clone().multiplyScalar(1.004));
            glow.userData.eventId = event.id;
            glow.userData.clusterId = cluster.id;
            glow.userData.clusterCount = cluster.count;
            glow.userData.lon = cluster.lon;
            glow.userData.lat = cluster.lat;
            glow.userData.recency = cluster.recency;
            glow.userData.phase = marker.userData.phase + 0.28;
            glow.userData.baseScale = marker.userData.baseScale;
            glow.userData.baseOpacity = isUsgs ? 0.045 + cluster.recency * 0.055 : (cluster.count > 1 ? 0.2 : 0.12) + cluster.recency * 0.16;
            markerGroup.add(glow);

            if (shouldRing) {
                const ringRadius = isUsgs
                    ? 0.042 + Math.min(0.028, clusterWeight * 0.008) + cluster.recency * 0.01
                    : 0.07 + Math.min(0.08, clusterWeight * 0.018) + cluster.recency * 0.018;
                const ring = new THREE.Mesh(
                    new THREE.RingGeometry(ringRadius, ringRadius + (isUsgs ? 0.006 : 0.012), 56),
                    new THREE.MeshBasicMaterial({
                        color,
                        transparent: true,
                        opacity: isUsgs ? 0.16 + cluster.recency * 0.14 : 0.28 + cluster.recency * 0.32,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                        side: THREE.DoubleSide
                    })
                );
                ring.position.copy(pos.clone().multiplyScalar(1.006));
                ring.lookAt(0, 0, 0);
                ring.userData.kind = 'pulseRing';
                ring.userData.eventId = event.id;
                ring.userData.clusterId = cluster.id;
                ring.userData.clusterCount = cluster.count;
                ring.userData.lon = cluster.lon;
                ring.userData.lat = cluster.lat;
                ring.userData.recency = cluster.recency;
                ring.userData.phase = Math.random();
                ring.userData.baseScale = isUsgs ? 0.82 + clusterWeight * 0.055 : 1 + clusterWeight * 0.18;
                ring.userData.baseOpacity = isUsgs ? 0.16 + cluster.recency * 0.14 : 0.28 + cluster.recency * 0.32;
                ring.userData.isRecentRing = state.recentRingIds.includes(cluster.id);
                ring.userData.isTodayHighlight = isTodayHighlightCluster(cluster);
                ring.userData.isUsgsRing = isUsgs;
                markerGroup.add(ring);

                if (!isUsgs && cluster.recency > 0.65 && state.recentRingIds.includes(cluster.id)) {
                    const echo = ring.clone();
                    echo.material = ring.material.clone();
                    echo.userData = {
                        ...ring.userData,
                        phase: ring.userData.phase + 0.5,
                        baseOpacity: ring.userData.baseOpacity * 0.58
                    };
                    markerGroup.add(echo);
                }
            }
        }
    }

    function updateInstancedLayer(layer, t, markerPulseAmp, hasSelection) {
        const isGlowLayer = layer.userData.kind === 'instancedGlowLayer';
        const instances = layer.userData.instances || [];
        instances.forEach((data, i) => {
            const selected = data.eventId === state.selectedId || data.clusterId === `cluster:${state.selectedId}`;
            const recency = data.recency || 0;
            const downplay = hasSelection && !selected;
            const pulseAmp = (downplay ? 0.025 : ((selected ? 0.24 : 0.07) + recency * (selected ? 0.12 : 0.08))) * markerPulseAmp;
            const pulse = 1 + Math.sin(t * (2.1 + recency * 1.2) + i * 0.37 + (data.phase || 0)) * pulseAmp;
            const selectedFactor = isGlowLayer ? 0.96 : 0.78;
            const scaleFactor = downplay ? 0.88 : (selected ? selectedFactor : 1);
            const radiusScale = isGlowLayer ? data.glowRadiusScale : data.markerRadiusScale;
            const position = isGlowLayer ? data.glowPosition : data.position;
            instancedScale.setScalar((data.baseScale || 1) * radiusScale * pulse * scaleFactor);
            instancedMatrix.compose(position, instancedQuaternion, instancedScale);
            layer.setMatrixAt(i, instancedMatrix);

            const dim = downplay ? 0.32 : selected ? 1.16 : 1;
            instancedColor.copy(data.color).multiplyScalar(dim).lerp(white, selected ? 0.18 : isGlowLayer ? 0.12 : 0);
            layer.setColorAt(i, instancedColor);
        });
        layer.instanceMatrix.needsUpdate = true;
        if (layer.instanceColor) layer.instanceColor.needsUpdate = true;
    }

    function updateMarkerAnimation(t, markerPulseAmp = 1) {
        const hasSelection = Boolean(state.selectedId);
        markerGroup.children.forEach((marker, i) => {
            if (marker.userData.kind === 'usgsPointLayer') {
                marker.material.uniforms.uTime.value = t;
                return;
            }
            if (marker.isInstancedMesh && (
                marker.userData.kind === 'instancedMarkerLayer' ||
                marker.userData.kind === 'instancedGlowLayer'
            )) {
                updateInstancedLayer(marker, t, markerPulseAmp, hasSelection);
                return;
            }
            const selected = marker.userData.eventId === state.selectedId || marker.userData.clusterId === `cluster:${state.selectedId}`;
            const recency = marker.userData.recency || 0;
            const downplay = hasSelection && !selected;
            if (marker.userData.kind === 'temporalAmberRing') {
                const wave = (t * 0.105 + (marker.userData.phase || 0)) % 1;
                const breathe = 1 + Math.sin((t * 0.42) + (marker.userData.phase || 0)) * 0.035;
                const temporalScale = (marker.userData.baseScale || 1) * breathe * (1 + wave * 0.52);
                const temporalFade = Math.pow(1 - wave, 1.28);
                marker.scale.setScalar(temporalScale * (downplay ? 0.88 : 1));
                if (marker.material?.opacity !== undefined) {
                    marker.material.opacity = (marker.userData.baseOpacity || 0.34) * temporalFade * (downplay ? 0.22 : 1);
                }
            } else if (marker.userData.kind === 'eventPolygonSurface') {
                if (marker.material?.opacity !== undefined) {
                    const surfacePulse = 0.82 + Math.sin(t * 0.36 + (marker.userData.phase || 0)) * 0.08;
                    marker.material.opacity = (marker.userData.baseOpacity || 0.11) * surfacePulse * (downplay ? 0.24 : 1);
                }
            } else if (marker.userData.kind === 'pulseRing') {
                const wave = (t * (0.24 + recency * 0.22) + (marker.userData.phase || 0)) % 1;
                const ringWaveAmp = marker.userData.isUsgsRing ? 0.48 + recency * 0.22 : 1.25 + recency * 0.9;
                const ringScale = (marker.userData.baseScale || 1) * (1 + wave * ringWaveAmp);
                const fade = Math.pow(1 - wave, 1.55);
                const emphasizedRing = marker.userData.isRecentRing || marker.userData.isTodayHighlight;
                const quietScale = downplay ? 0.82 : (emphasizedRing ? 0.94 : 1);
                marker.scale.setScalar(ringScale * (selected ? 0.78 : quietScale));
                if (marker.material?.opacity !== undefined) {
                    const quietOpacity = downplay ? 0.08 : (emphasizedRing ? (marker.userData.isUsgsRing ? 0.62 : 0.5) : 1);
                    marker.material.opacity = (marker.userData.baseOpacity || 0.25) * fade * (selected ? 0.9 : quietOpacity);
                }
            } else {
                const pulseAmp = (downplay ? 0.025 : ((selected ? 0.24 : 0.07) + recency * (selected ? 0.12 : 0.08))) * markerPulseAmp;
                const pulse = 1 + Math.sin(t * (2.1 + recency * 1.2) + i * 0.37 + (marker.userData.phase || 0)) * pulseAmp;
                const scaleFactor = downplay ? 0.88 : (selected ? 0.78 : 1);
                marker.scale.setScalar((marker.userData.baseScale || 1) * pulse * scaleFactor);
                if (marker.material?.opacity !== undefined) {
                    const boosted = (marker.userData.baseOpacity || 0.3) * (selected ? 1.02 : downplay ? 0.18 : 0.72);
                    marker.material.opacity = Math.min(0.96, boosted);
                }
            }
        });

        trailGroup.children.forEach(node => {
            if (node.userData.kind === 'selectedLocator') {
                const ping = 1 + Math.sin(t * 3.2 + (node.userData.phase || 0)) * 0.05;
                node.scale.setScalar((node.userData.baseScale || 1) * ping);
                node.material.opacity = (node.userData.baseOpacity || 0.9) * (0.88 + Math.sin(t * 2.6) * 0.05);
            }
        });
    }

    return {
        addMarkers,
        clearMarkers,
        clearSelectionTrail,
        buildSelectionTrail,
        updateMarkerAnimation,
        buildClusters,
        updateRecentRingTargets
    };
}
