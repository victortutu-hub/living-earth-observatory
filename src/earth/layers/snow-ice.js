// Faza 1 - Sprint 1.5: masca de zapada/gheata (MODIS Terra NDSI Snow Cover,
// GIBS). E o textura overlay pe sfera Earth, nu un set de puncte selectabile
// - de aceea layer 'custom' in registry (acelasi tipar ca aurora.js), nu
// 'points'. Provenance citita din source-registry (sourceKey 'gibs' ->
// 'observed'): mascheaza direct un produs satelitar zilnic.
//
// LOT 5: date-selectable. Dale WMTS z2 cu data in URL (gibs-snow-ice.js);
// registry-ul apeleaza setDataDay(day) inainte de setEnabled(true). O zi din
// gol / din intarzierea de publicare nu ajunge aici: timeCapability o declara
// "not available" si registry-ul ascunde layerul. Textura veche se elibereaza
// la inlocuire si nu ramane vizibila cat se incarca ziua noua.
import { disposeSnowIceTexture, loadSnowIceMaskTexture } from '../gibs-snow-ice.js';
import {
    EARTH_TIME_CAPABILITIES,
    composeHistoricalStatus,
    composeSourceStatus,
    formatLoadingDay,
} from '../temporal-provenance.js';

export const snowIcePlugin = {
    id: 'snowIce',
    label: 'Snow & ice',
    sourceKey: 'gibs',
    temporal: { temporalType: 'observed', sceneTimeCompatibility: 'date-selectable', cacheState: 'unknown' },
    timeCapability: EARTH_TIME_CAPABILITIES.snowIce,
    attribution: 'NASA GIBS / MODIS Terra NDSI Snow Cover',
    license: 'NASA public domain; attribution retained.',
    source: { url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Terra_NDSI_Snow_Cover', requiresProxy: false, apiKey: null },
    render: 'custom',
    createLayer({ THREE, earthGroup, loadTexture = loadSnowIceMaskTexture }) {
        let disposed = false;
        let enabled = false;
        let loading = false;
        let lastError = null;
        let lastLoadedAt = null;
        let mesh = null;
        let material = null;
        let dataDay = null;      // requested day, null = Live
        let shownKey = null;     // day key of the texture on the mesh ('live' or a day)
        let generation = 0;
        let controller = null;

        const keyFor = (day) => day || 'live';

        function ensureMesh(texture) {
            if (mesh) {
                material.map = texture;
                material.needsUpdate = true;
                return;
            }
            material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: 0.82,
                depthWrite: false
            });
            mesh = new THREE.Mesh(new THREE.SphereGeometry(2.03, 128, 80), material);
            mesh.name = 'gibs-snow-ice-mask';
            mesh.renderOrder = 3;
            mesh.visible = false;
            earthGroup.add(mesh);
        }

        function cancelLoad() {
            generation += 1;
            controller?.abort();
            controller = null;
            loading = false;
        }

        async function load() {
            if (disposed) return;
            cancelLoad();
            const current = generation;
            const own = new AbortController();
            controller = own;
            const day = dataDay;
            loading = true;
            lastError = null;
            if (mesh) mesh.visible = false; // never show the previous day for this one
            try {
                const texture = await loadTexture({ THREE, day, signal: own.signal });
                if (disposed || current !== generation) {
                    disposeSnowIceTexture(texture);
                    return;
                }
                const previous = material?.map || null;
                ensureMesh(texture);
                if (previous && previous !== texture) disposeSnowIceTexture(previous);
                shownKey = keyFor(day);
                mesh.visible = enabled;
                lastLoadedAt = Date.now();
            } catch (error) {
                if (current !== generation || error?.name === 'AbortError') return;
                lastError = error;
            } finally {
                if (current === generation) {
                    loading = false;
                    if (controller === own) controller = null;
                }
            }
        }

        async function setDataDay(day) {
            if (disposed) return;
            const next = day || null;
            if (next === dataDay) return;
            dataDay = next;
            cancelLoad();
            lastError = null;
            if (mesh && shownKey !== keyFor(dataDay)) mesh.visible = false;
        }

        async function setEnabled(value) {
            if (disposed) return;
            enabled = Boolean(value);
            if (!enabled) {
                cancelLoad();
                if (mesh) mesh.visible = false;
                return;
            }
            if (mesh && shownKey === keyFor(dataDay)) {
                mesh.visible = true;
                return;
            }
            if (!loading) await load();
        }

        function update() {}

        function getStatus() {
            if (loading) {
                return { enabled, loading, state: 'refreshing', message: dataDay ? formatLoadingDay('Snow & ice', dataDay) : 'Snow & ice: loading NASA GIBS / MODIS Terra NDSI...' };
            }
            if (lastError) return { enabled, loading, state: 'error', message: `Snow & ice: ${lastError.message || 'network error'}` };
            if (!enabled) return { enabled, loading, state: 'off', message: 'Snow & ice: off' };
            if (dataDay && shownKey === dataDay) {
                const status = composeHistoricalStatus({ sourceKey: 'gibs', source: 'NASA GIBS / MODIS Terra NDSI', noun: 'daily snow cover', day: dataDay, count: null });
                return { enabled, loading, state: 'on', ...status };
            }
            const status = composeSourceStatus({
                sourceKey: 'gibs',
                message: 'Snow & ice: NASA GIBS / MODIS Terra NDSI daily product',
                dataTime: material?.map?.userData?.temporal?.sourceTime || null,
                fetchedAt: lastLoadedAt,
                fetchState: 'live',
            });
            return { enabled, loading, state: 'on', ...status };
        }

        function dispose() {
            if (disposed) return;
            disposed = true;
            cancelLoad();
            if (mesh) {
                earthGroup.remove(mesh);
                mesh.geometry.dispose();
            }
            disposeSnowIceTexture(material?.map);
            material?.dispose();
        }

        return { setEnabled, setDataDay, update, getStatus, dispose, debugState: () => ({ dataDay, shownKey, loading, visible: Boolean(mesh?.visible), textureDay: material?.map?.userData?.snowIceDate || null }) };
    }
};
