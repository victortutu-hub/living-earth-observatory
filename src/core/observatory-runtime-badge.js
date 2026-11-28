// Runtime badges describe a running observatory. A registry record without a
// route (planned, research, in development) is not a service that can be
// up or down, so it never shows LIVE/FALLBACK/OFFLINE: it shows its declared
// registry status instead.
// LOT 21: a live child observatory without a gateway preview (Living Himalaya)
// has no runtime signal on the landing page. It shows a runtime badge only
// while it is mounted (Atlas): its record then carries the phase of a running
// module (loading / ready / error), copied from the child page; idle (never
// mounted) or cancelled (unmounted) means no runtime claim.

/**
 * LOT 49: the visible label of a runtime record. A module still loading is coded FALLBACK + phase 'loading' (the
 * module context's "module-starting" convention); its badge reads "LOADING", the record itself is unchanged.
 */
export function runtimeBadgeLabel(record) {
    if (record?.phase === 'loading') return 'LOADING';
    return record?.value || 'FALLBACK';
}

export function hasRuntime(observatory) {
    return Boolean(observatory?.route);
}

export function isMountedRuntime(record) {
    return Boolean(record) && Boolean(record.phase) && record.phase !== 'idle' && record.phase !== 'cancelled';
}

/** A live child observatory without a gateway preview: badge only while mounted. */
export function isMountOnlyRuntime(observatory) {
    return Boolean(observatory?.parent) && !observatory?.gateway?.enabled;
}

/**
 * Badge for one observatory: runtime state for routed live observatories, the
 * registry status (e.g. "PLANNED", "IN DEVELOPMENT") for the rest. A routed
 * `development` record has a page but no live service status, so it shows its
 * declared status, never OFFLINE/FALLBACK. A live child without a gateway
 * preview shows its runtime state only while mounted ("NOT RUNNING" otherwise,
 * runtimeBound false: the landing card shows the "Live" chip and its CTA only).
 */
export function observatoryRuntimeBadge(observatory, runtimeRecord, statusLabel) {
    if (!hasRuntime(observatory) || observatory.status !== 'live') {
        return { text: String(statusLabel || observatory?.status || 'declared').toUpperCase(), state: 'declared', runtimeBound: false };
    }
    if (isMountOnlyRuntime(observatory) && !isMountedRuntime(runtimeRecord)) {
        return { text: 'NOT RUNNING', state: 'declared', runtimeBound: false };
    }
    return { text: runtimeBadgeLabel(runtimeRecord), state: runtimeRecord?.state || 'fallback', runtimeBound: true };
}
