// Faza 1 - Sprint 1.1: registry de layere.
//
// Scopul: o sursa noua de date sa insemne UN fisier plugin + o linie de
// inregistrare, in loc sa atinga ~6-7 fisiere (provider + live-data-layers +
// control-panel + app-services + app-runtime + HTML + config), asa cum era pana
// acum. Registry-ul auto-genereaza butonul din toolbar si randul de status,
// gestioneaza toggle/fetch(abort)/normalize/render si pastreaza proveniente si
// atribuire vizibile - fara sa dublam logica per sursa.
//
// Contractul LayerPlugin (obiect simplu, fara clase):
//   {
//     id:          string   // unic, ex. 'gvp'
//     label:       string   // text buton, ex. 'Smithsonian volcanoes'
//     sourceKey:   string   // cheie in src/config/source-registry.js; proveniența
//                           // (vocabularul canonic din AGENTS.md: observed |
//                           // reconstructed | physical-model | simulation |
//                           // prediction | interpretive | fallback) se citeste
//                           // DOAR de acolo - plugin-ul nu o redeclara.
//     attribution: string    // obligatoriu, non-null (identitatea proiectului)
//     license:     string
//     source:      { url: string, requiresProxy?: boolean, apiKey?: string|null }
//     cadence?:    number    // ms intre refresh-uri automate (optional)
//     timeCapability: obiect createTimeCapability (temporal-provenance.js),
//                  OBLIGATORIU (LOT 5): ce poate arata layerul pentru o zi
//                  aleasa; fara date pentru ziua aleasa -> ascuns, cu
//                  "Not available for <day>", butonul ramane pornit si marcat
//     render:      'points' | 'custom'
//     // pentru 'points' (sursa declarativa de puncte selectabile):
//     async fetch(signal): Promise<raw>          // implicit: GET url -> JSON
//     normalize(raw): Array<{ lon, lat, size?, color?, title?, detail? }>
//     // pentru 'custom' (layer self-managed, ex. aurora cu mesh + shader propriu):
//     createLayer({THREE, earthGroup, lonLatToVec3}):
//         { async setEnabled(bool), update(t), getStatus()->{state,message}, dispose(),
//           async setDataDay?(day|null) }   // doar layerele date-selectable
//   }
//
// resolveUrl(plugin) primeste din afara politica de proxy (acelasi
// NASA_PROXY_BASE folosit de restul aplicatiei), ca sa nu cablam iar manual.

import { describeSourceProvenance } from '../config/source-registry.js';
import { composeSourceStatus, fetchStateFromProxyStatus, formatLoadingDay } from './temporal-provenance.js';

// Varsta relativa din status ("fetched 7 min ago") se recalculeaza din
// timestamp-uri la acest interval, din hook-ul per-frame update(t).
const STATUS_REFRESH_SECONDS = 30;

// Termina o fraza cu exact un punct (licentele se termina deja cu '.').
function asSentence(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Tooltip-ul butonului unui plugin: atribuire + licenta, apoi proveniența din registry. */
export function buildPluginTooltip(plugin) {
    const provenance = describeSourceProvenance(plugin?.sourceKey);
    return [`${plugin?.attribution} - ${plugin?.license}`, provenance?.title]
        .map(asSentence)
        .filter(Boolean)
        .join(' ');
}

function createPointsRenderer({ THREE, earthGroup, lonLatToVec3 }) {
    const group = new THREE.Group();
    group.name = 'layer-plugin-points';
    earthGroup.add(group);

    const uniforms = {
        uTime: { value: 0 },
        uOpacity: { value: 0.9 },
        uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) }
    };
    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        // Plugins still use their smooth facing fade, but must respect the
        // opaque Earth depth buffer for far-side features.
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            attribute float aSize;
            attribute float aPhase;
            varying vec3 vColor;
            varying float vFacing;
            uniform float uTime;
            uniform float uPixelRatio;
            void main() {
                vColor = color;
                float pulse = 0.82 + 0.18 * sin(uTime * 2.4 + aPhase);
                vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                vec3 worldNormal = normalize(worldPos);
                vec3 viewDir = normalize(cameraPosition - worldPos);
                vFacing = smoothstep(-0.06, 0.30, dot(worldNormal, viewDir));
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * pulse * uPixelRatio * (300.0 / max(90.0, -mvPosition.z));
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vFacing;
            uniform float uOpacity;
            void main() {
                vec2 p = gl_PointCoord - 0.5;
                float d = length(p) * 2.0;
                float core = smoothstep(0.55, 0.0, d);
                float ring = smoothstep(0.86, 0.6, d) * smoothstep(0.34, 0.6, d);
                float alpha = (core * 0.9 + ring * 0.6) * vFacing * uOpacity;
                if (alpha < 0.02) discard;
                gl_FragColor = vec4(vColor, alpha);
            }
        `
    });
    material.vertexColors = true;

    let points = null;

    function clear() {
        if (!points) return;
        group.remove(points);
        points.geometry?.dispose?.();
        points = null;
    }

    function render(items) {
        clear();
        if (!items || !items.length) return;
        const count = items.length;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const scratch = new THREE.Vector3();
        const color = new THREE.Color();
        for (let i = 0; i < count; i++) {
            const it = items[i];
            lonLatToVec3(it.lon, it.lat, 2.13, scratch);
            positions[i * 3] = scratch.x;
            positions[i * 3 + 1] = scratch.y;
            positions[i * 3 + 2] = scratch.z;
            color.set(it.color != null ? it.color : 0xff7a3c);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
            sizes[i] = Number.isFinite(it.size) ? it.size : 9;
            phases[i] = (i * 12.9898) % 6.283;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.userData.items = items; // pentru picking per-index (panou + track)
        group.add(points);
    }

    return {
        render,
        clear,
        getPoints: () => points,
        update(t) { uniforms.uTime.value = t; },
        dispose() {
            clear();
            material.dispose();
            earthGroup.remove(group);
        }
    };
}

function temporalSuffix(plugin) {
    const temporal = plugin?.temporal;
    if (!temporal) return '';
    if (temporal.temporalType === 'procedural') return ' · Procedural';
    if (temporal.temporalType === 'historical-catalog') return ' · Historical catalog';
    if (temporal.temporalType === 'static-reference') return ' · Static reference';
    if (temporal.sceneTimeCompatibility === 'latest-only') return ' · Latest available data';
    if (temporal.sceneTimeCompatibility === 'date-selectable') return '';
    return temporal.sceneTimeCompatibility === 'yes' ? ' · Scene-time model' : '';
}

const RENDERERS = {
    points: createPointsRenderer
};

export function createLayerRegistry({ THREE, earthGroup, lonLatToVec3, resolveUrl, onSelectFeature }) {
    // Container idempotent in toolbar: la re-init (module host destroy/start) il
    // recreem, ca sa nu ramana butoane duplicate.
    const toolbar = document.getElementById('toolbar');
    let container = document.getElementById('layerPluginBar');
    if (container) container.remove();
    container = document.createElement('div');
    container.id = 'layerPluginBar';
    container.className = 'layer-plugin-bar';
    toolbar?.appendChild(container);

    const entries = new Map();
    let lastStatusRefresh = null;
    let dataDay = null; // UTC day of the scene (null = Live), see setDataDay()

    function setStatus(entry, stateName, message, title = '') {
        entry.statusEl.dataset.state = stateName;
        entry.statusEl.textContent = message;
        entry.statusEl.title = title;
    }

    function timeResolution(entry) {
        return entry.plugin.timeCapability.resolve(dataDay);
    }

    // The user wants the layer but it has nothing for the chosen day: hidden,
    // button still "on" and marked, status "Not available for <day> — ...".
    function hideForTime(entry, resolved) {
        entry.generation += 1;
        entry.controller?.abort?.();
        if (entry.layer) entry.layer.setEnabled(false);
        else entry.renderer.clear();
        entry.enabled = false;
        entry.timeHidden = true;
        entry.points = null;
        entry.btn.textContent = `${entry.plugin.label}: on`;
        entry.btn.dataset.timeUnavailable = 'true';
        setStatus(entry, 'unavailable', `${entry.plugin.label}: ${entry.plugin.timeCapability.unavailableMessage(dataDay, resolved.reason)}`, entry.plugin.timeCapability.note || '');
    }

    function renderCustomStatus(entry) {
        const { plugin } = entry;
        const st = entry.layer.getStatus?.() || {};
        setStatus(entry, st.state || 'on', `${st.message || `${plugin.label}: on`}${temporalSuffix(plugin)}`, st.title || '');
    }

    // Puncte (ex. GVP): statusul se compune din count + invelisul proxy-ului.
    function renderPointsStatus(entry) {
        const { plugin, points } = entry;
        const status = composeSourceStatus({
            sourceKey: plugin.sourceKey,
            message: `${plugin.label}: ${points.count} (${plugin.attribution})`,
            fetchedAt: points.fetchedAt,
            fetchState: points.fetchState,
        });
        setStatus(entry, 'on', `${status.message}${temporalSuffix(plugin)}`, status.title);
    }

    function makeRenderer(kind) {
        const factory = RENDERERS[kind] || RENDERERS.points;
        return factory({ THREE, earthGroup, lonLatToVec3 });
    }

    async function enable(entry) {
        const { plugin } = entry;
        entry.wanted = true;
        const resolved = timeResolution(entry);
        if (!resolved.available) {
            hideForTime(entry, resolved);
            return;
        }
        entry.timeHidden = false;
        delete entry.btn.dataset.timeUnavailable;
        const generation = ++entry.generation;
        const loadingText = dataDay && plugin.timeCapability.dateSelectable
            ? formatLoadingDay(plugin.label, dataDay)
            : `${plugin.label}: loading...`;

        // Layer self-managed (render:'custom'): plugin-ul isi face singur
        // fetch+render+update (ex. aurora, cu mesh oval si shader propriu).
        // Registry-ul ii da doar UI + lifecycle si citeste getStatus().
        if (entry.layer) {
            setStatus(entry, 'pending', loadingText);
            entry.btn.textContent = `${plugin.label}: on`;
            try {
                await entry.layer.setDataDay?.(dataDay);
                if (generation !== entry.generation) return;
                await entry.layer.setEnabled(true);
                if (generation !== entry.generation) return;
                entry.enabled = true;
                renderCustomStatus(entry);
            } catch (error) {
                if (generation !== entry.generation) return;
                entry.enabled = false;
                entry.wanted = false;
                entry.btn.textContent = `${plugin.label}: off`;
                setStatus(entry, 'error', `${plugin.label}: unavailable (${error.message})`);
            }
            return;
        }

        entry.controller?.abort?.();
        entry.controller = new AbortController();
        setStatus(entry, 'pending', loadingText);
        try {
            const url = resolveUrl ? resolveUrl(plugin) : plugin.source.url;
            const raw = plugin.fetch
                ? await plugin.fetch(entry.controller.signal, url)
                : await fetch(url, { signal: entry.controller.signal, cache: 'no-store' }).then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                });
            if (generation !== entry.generation) return;
            const items = plugin.normalize ? plugin.normalize(raw) : raw;
            entry.renderer.render(items);
            const obj = entry.renderer.getPoints?.();
            if (obj) obj.userData.pluginId = plugin.id; // pentru rezolvarea la picking
            entry.enabled = true;
            entry.btn.textContent = `${plugin.label}: on`;
            const envelope = raw && typeof raw === 'object' && 'proxyStatus' in raw ? raw : null;
            entry.points = {
                count: items.length,
                fetchedAt: envelope?.proxyFetchedAt || new Date().toISOString(),
                fetchState: envelope ? fetchStateFromProxyStatus(envelope.proxyStatus) : 'live',
            };
            renderPointsStatus(entry);
        } catch (error) {
            if (error?.name === 'AbortError' || generation !== entry.generation) return;
            entry.enabled = false;
            entry.wanted = false;
            entry.btn.textContent = `${plugin.label}: off`;
            setStatus(entry, 'error', `${plugin.label}: unavailable (${error.message})`);
        }
    }

    function disable(entry) {
        entry.generation += 1;
        entry.controller?.abort?.();
        if (entry.layer) {
            entry.layer.setEnabled(false);
        } else {
            entry.renderer.clear();
        }
        entry.enabled = false;
        entry.wanted = false;
        entry.timeHidden = false;
        delete entry.btn.dataset.timeUnavailable;
        entry.points = null;
        entry.btn.textContent = `${entry.plugin.label}: off`;
        setStatus(entry, 'off', `${entry.plugin.label}: off`);
    }

    function register(plugin) {
        if (!plugin?.id || entries.has(plugin.id)) return;
        if (typeof plugin.timeCapability?.resolve !== 'function') {
            throw new TypeError(`Layer plugin "${plugin.id}" must declare a timeCapability (LOT 5).`);
        }
        const btn = document.createElement('button');
        btn.id = `${plugin.id}LayerBtn`;
        btn.textContent = `${plugin.label}: off`;
        btn.title = buildPluginTooltip(plugin);
        const statusEl = document.createElement('div');
        statusEl.id = `${plugin.id}LayerStatus`;
        statusEl.className = 'layer-plugin-status';
        statusEl.dataset.state = 'off';
        statusEl.textContent = `${plugin.label}: off`;
        container.appendChild(btn);
        container.appendChild(statusEl);

        const isCustom = plugin.render === 'custom' && typeof plugin.createLayer === 'function';
        const entry = {
            plugin,
            btn,
            statusEl,
            enabled: false,   // visible and loaded
            wanted: false,    // the user's choice; kept while hidden for time
            timeHidden: false,
            generation: 0,    // bumped on every enable/disable/day change
            controller: null,
            renderer: isCustom ? null : makeRenderer(plugin.render),
            layer: isCustom ? plugin.createLayer({ THREE, earthGroup, lonLatToVec3 }) : null
        };
        btn.addEventListener('click', () => (entry.wanted ? disable(entry) : enable(entry)));
        entries.set(plugin.id, entry);
        return entry;
    }

    /**
     * The scene's UTC day changed (null = Live). Layers the user turned on are
     * re-evaluated: a date-selectable layer loads the new day, a layer without
     * data for it is hidden, and hidden layers come back in Live.
     */
    function setDataDay(day) {
        if (day === dataDay) return;
        dataDay = day || null;
        for (const entry of entries.values()) {
            if (!entry.wanted) continue;
            const resolved = timeResolution(entry);
            if (!resolved.available) {
                hideForTime(entry, resolved);
                continue;
            }
            if (entry.timeHidden || entry.plugin.timeCapability.dateSelectable) enable(entry);
        }
    }

    function update(t) {
        const refreshStatus = lastStatusRefresh === null || t - lastStatusRefresh >= STATUS_REFRESH_SECONDS;
        if (refreshStatus) lastStatusRefresh = t;
        for (const entry of entries.values()) {
            if (!entry.enabled) continue;
            if (entry.layer) entry.layer.update?.(t);
            else entry.renderer.update?.(t);
            if (!refreshStatus) continue;
            if (entry.layer) renderCustomStatus(entry);
            else if (entry.points) renderPointsStatus(entry);
        }
    }

    // Obiectele Points vii ale layerelor active - date interactiunii de scena ca
    // sa fie selectabile per-punct exact ca markerele de evenimente.
    function getPointObjects() {
        const out = [];
        for (const entry of entries.values()) {
            if (!entry.enabled || !entry.renderer) continue;
            const obj = entry.renderer.getPoints?.();
            if (obj) out.push(obj);
        }
        return out;
    }

    // Apelata de interactiune la un hit pe un punct: rezolva item-ul si deleaga
    // catre onSelectFeature (panou de detalii + track camera), reutilizand exact
    // acelasi mecanism ca ISS/Luna.
    function selectPoint(object, index) {
        const item = object?.userData?.items?.[index];
        if (!item) return;
        const entry = entries.get(object.userData.pluginId);
        onSelectFeature?.(item, entry?.plugin || null);
    }

    function dispose() {
        for (const entry of entries.values()) {
            entry.controller?.abort?.();
            if (entry.layer) entry.layer.dispose?.();
            else entry.renderer.dispose?.();
        }
        entries.clear();
        container?.remove();
    }

    return { register, update, dispose, getPointObjects, selectPoint, setDataDay, entryState: (id) => {
        const entry = entries.get(id);
        return entry ? { enabled: entry.enabled, wanted: entry.wanted, timeHidden: entry.timeHidden, status: entry.statusEl.textContent, state: entry.statusEl.dataset.state } : null;
    } };
}
