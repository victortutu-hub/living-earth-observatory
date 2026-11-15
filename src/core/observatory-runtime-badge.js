// Runtime badges describe a running observatory. A registry record without a
// route (planned, research, in development) is not a service that can be
// up or down, so it never shows LIVE/FALLBACK/OFFLINE: it shows its declared
// registry status instead.

export function hasRuntime(observatory) {
    return Boolean(observatory?.route);
}

/**
 * Badge for one observatory: runtime state for routed live observatories, the
 * registry status (e.g. "PLANNED", "IN DEVELOPMENT") for the rest. A routed
 * `development` record (Living Himalaya) has a page but no live service
 * status, so it shows its declared status, never OFFLINE/FALLBACK.
 */
export function observatoryRuntimeBadge(observatory, runtimeRecord, statusLabel) {
    if (!hasRuntime(observatory) || observatory.status !== 'live') {
        return { text: String(statusLabel || observatory?.status || 'declared').toUpperCase(), state: 'declared', runtimeBound: false };
    }
    return { text: runtimeRecord?.value || 'FALLBACK', state: runtimeRecord?.state || 'fallback', runtimeBound: true };
}
