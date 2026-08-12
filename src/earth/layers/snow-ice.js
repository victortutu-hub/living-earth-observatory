// Faza 1 - Sprint 1.5: masca de zapada/gheata (MODIS Terra NDSI Snow Cover,
// GIBS). E o textura overlay pe sfera Earth, nu un set de puncte selectabile
// - de aceea layer 'custom' in registry (acelasi tipar ca aurora.js), nu
// 'points'. Provenance 'observed': mascheaza direct un produs satelitar
// zilnic, fara interpretare procedurala intre mijloc.
import { loadSnowIceMaskTexture } from '../gibs-snow-ice.js?v=snowIce1';

function formatClock(timestamp) {
    if (!timestamp) return '--:--';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const snowIcePlugin = {
    id: 'snowIce',
    label: 'Snow & ice',
    provenance: 'observed',
    attribution: 'NASA GIBS / MODIS Terra NDSI Snow Cover',
    license: 'NASA public domain; attribution retained.',
    source: { url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi', requiresProxy: false, apiKey: null },
    render: 'custom',
    createLayer({ THREE, earthGroup }) {
        let disposed = false;
        let enabled = false;
        let loading = false;
        let lastError = null;
        let lastLoadedAt = null;
        let mesh = null;
        let material = null;

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

        async function load() {
            if (disposed) return;
            loading = true;
            lastError = null;
            try {
                const texture = await loadSnowIceMaskTexture({ THREE });
                if (disposed) return;
                ensureMesh(texture);
                mesh.visible = enabled;
                lastLoadedAt = Date.now();
            } catch (error) {
                lastError = error;
            } finally {
                loading = false;
            }
        }

        async function setEnabled(value) {
            if (disposed) return;
            enabled = Boolean(value);
            if (mesh) mesh.visible = enabled;
            if (enabled && !mesh && !loading) await load();
        }

        function update() {}

        function getStatus() {
            if (loading) return { enabled, loading, state: 'refreshing', message: 'Snow & ice: loading NASA GIBS / MODIS Terra NDSI...' };
            if (lastError) return { enabled, loading, state: 'error', message: `Snow & ice: ${lastError.message || 'network error'}` };
            if (!enabled) return { enabled, loading, state: 'off', message: 'Snow & ice: off' };
            const date = material?.map?.userData?.snowIceDate;
            return {
                enabled,
                loading,
                state: 'on',
                message: date
                    ? `Snow & ice: NASA GIBS / MODIS Terra NDSI, ${date}, updated ${formatClock(lastLoadedAt)}`
                    : `Snow & ice: on, updated ${formatClock(lastLoadedAt)}`
            };
        }

        function dispose() {
            if (disposed) return;
            disposed = true;
            if (mesh) {
                earthGroup.remove(mesh);
                mesh.geometry.dispose();
            }
            material?.dispose();
            material?.map?.dispose?.();
        }

        return { setEnabled, update, getStatus, dispose };
    }
};
