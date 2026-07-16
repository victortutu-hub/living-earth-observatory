import { atlasStatus } from '../core/status-store.js?v=unifiedEarthLot2';

const ASTRONOMY_ENGINE_URLS = Object.freeze([
    'https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/+esm',
    'https://esm.sh/astronomy-engine@2.1.19',
]);
const RETRY_DELAY_MS = 30_000;

let astronomyEngine = null;
let loadPromise = null;
let retryAt = 0;
let activeUrl = null;
let lastError = null;

function publish(value, state, meta = {}) {
    atlasStatus.setStatus('astronomy', value, state, {
        phase: meta.phase || (state === 'live' ? 'ready' : 'error'),
        cache: 'module',
        networkState: meta.networkState || null,
        reason: meta.reason || null,
        error: meta.error || null,
        sourceTime: null,
        updated: new Date().toISOString(),
    });
}

export async function loadAstronomyEngine() {
    if (astronomyEngine) return astronomyEngine;
    if (Date.now() < retryAt) return null;
    if (!loadPromise) {
        publish('LOADING', 'fallback', { phase: 'loading', networkState: 'loading' });
        loadPromise = (async () => {
            for (const url of ASTRONOMY_ENGINE_URLS) {
                try {
                    const module = await import(url);
                    astronomyEngine = module.default || module;
                    activeUrl = url;
                    lastError = null;
                    publish('LIVE', 'live', { networkState: 'online' });
                    return astronomyEngine;
                } catch (error) {
                    lastError = error;
                    console.warn(`[Astronomy Runtime] Import failed from ${url}.`, error);
                }
            }
            retryAt = Date.now() + RETRY_DELAY_MS;
            publish('OFFLINE', 'offline', {
                reason: 'import-unavailable',
                error: lastError?.message || String(lastError),
                networkState: 'offline',
            });
            return null;
        })().finally(() => {
            loadPromise = null;
        });
    }
    return loadPromise;
}

export function getAstronomyImportState() {
    return Object.freeze({
        loaded: Boolean(astronomyEngine),
        loading: Boolean(loadPromise),
        activeUrl,
        retryAt: retryAt || null,
        error: lastError?.message || null,
    });
}

