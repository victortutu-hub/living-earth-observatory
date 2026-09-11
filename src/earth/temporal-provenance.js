// Temporal provenance is deliberately separate from a source's scientific
// provenance.  Scene time controls astronomy; source time belongs to data;
// loadedAt only records transport/cache activity.  Keeping this tiny contract
// here lets existing layer/status surfaces describe that distinction without a
// second runtime or provider abstraction.
export const TEMPORAL_TYPES = Object.freeze([
    'physical-model',
    'observed',
    'observed-derived',
    'historical-catalog',
    'static-reference',
    'procedural'
]);

export const SCENE_TIME_COMPATIBILITY = Object.freeze(['yes', 'latest-only', 'static', 'unknown']);
export const CACHE_STATES = Object.freeze(['fresh', 'stale', 'fallback', 'unknown']);

const VALID_TYPES = new Set(TEMPORAL_TYPES);
const VALID_COMPATIBILITY = new Set(SCENE_TIME_COMPATIBILITY);
const VALID_CACHE_STATES = new Set(CACHE_STATES);

function validTimestamp(value) {
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function createTemporalDescriptor({
    temporalType,
    sourceTime = null,
    sceneTimeCompatibility = 'unknown',
    loadedAt = null,
    cacheState = 'unknown',
    fallbackReason = null,
} = {}) {
    if (!VALID_TYPES.has(temporalType)) throw new TypeError(`Unknown temporal type: ${temporalType}`);
    if (!VALID_COMPATIBILITY.has(sceneTimeCompatibility)) throw new TypeError(`Unknown scene-time compatibility: ${sceneTimeCompatibility}`);
    if (!VALID_CACHE_STATES.has(cacheState)) throw new TypeError(`Unknown cache state: ${cacheState}`);
    return Object.freeze({
        temporalType,
        sourceTime: validTimestamp(sourceTime),
        sceneTimeCompatibility,
        loadedAt: validTimestamp(loadedAt),
        cacheState,
        fallbackReason: fallbackReason || null,
    });
}

export const EARTH_TEMPORAL_LAYERS = Object.freeze({
    sun: createTemporalDescriptor({ temporalType: 'physical-model', sceneTimeCompatibility: 'yes' }),
    moon: createTemporalDescriptor({ temporalType: 'physical-model', sceneTimeCompatibility: 'yes' }),
    blueMarble: createTemporalDescriptor({ temporalType: 'static-reference', sceneTimeCompatibility: 'static' }),
    blackMarble: createTemporalDescriptor({ temporalType: 'observed', sourceTime: '2016-01-01T00:00:00Z', sceneTimeCompatibility: 'static' }),
    etopo: createTemporalDescriptor({ temporalType: 'static-reference', sceneTimeCompatibility: 'static' }),
    clouds: createTemporalDescriptor({ temporalType: 'procedural', sceneTimeCompatibility: 'static' }),
    snowIce: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'latest-only' }),
    eonet: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'latest-only' }),
    usgs: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'latest-only' }),
    firms: createTemporalDescriptor({ temporalType: 'observed', sceneTimeCompatibility: 'latest-only' }),
    aurora: createTemporalDescriptor({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' }),
    wind: createTemporalDescriptor({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' }),
    oceanCurrents: createTemporalDescriptor({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' }),
    gvp: createTemporalDescriptor({ temporalType: 'historical-catalog', sceneTimeCompatibility: 'static' }),
    iss: createTemporalDescriptor({ temporalType: 'physical-model', sceneTimeCompatibility: 'yes' }),
});

function formatUtc(iso) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(iso)).replace(',', '') + ' UTC';
}

export function formatTemporalBadge(descriptor, { sourceLabel = 'Observed' } = {}) {
    const temporal = createTemporalDescriptor(descriptor);
    if (temporal.temporalType === 'procedural') return temporal.cacheState === 'fallback' ? 'Procedural fallback' : 'Procedural';
    if (temporal.temporalType === 'static-reference') return 'Static reference';
    if (temporal.temporalType === 'historical-catalog') return 'Historical catalog';
    const parts = [temporal.sourceTime ? `${sourceLabel} · ${formatUtc(temporal.sourceTime)}` : `${sourceLabel} · source time unavailable`];
    if (temporal.cacheState === 'stale') parts.push('stale');
    else if (temporal.cacheState === 'fallback') parts.push('fallback');
    return parts.join(' · ');
}
