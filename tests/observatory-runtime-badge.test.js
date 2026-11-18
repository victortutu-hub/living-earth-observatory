import { beforeAll, describe, expect, it } from 'vitest';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { hasRuntime, isMountedRuntime, isMountOnlyRuntime, observatoryRuntimeBadge } from '../src/core/observatory-runtime-badge.js';

const statusLabel = (id) => PLATFORM_TAXONOMY.statuses.find((status) => status.id === id)?.label;
const byId = (id) => OBSERVATORY_REGISTRY.find((item) => item.id === id);

describe('runtime badge: planned observatories are not "offline"', () => {
    it('shows the registry status for records without a route', () => {
        expect(observatoryRuntimeBadge(byId('network-pulse'), null, statusLabel('planned')))
            .toEqual({ text: 'PLANNED', state: 'declared', runtimeBound: false });
        expect(observatoryRuntimeBadge(byId('living-ocean'), { value: 'OFFLINE', state: 'offline' }, statusLabel('research')))
            .toEqual({ text: 'RESEARCH', state: 'declared', runtimeBound: false });
        expect(observatoryRuntimeBadge(byId('living-sun'), null, statusLabel('development')).text).toBe('IN DEVELOPMENT');
    });

    it('a routed development record shows its status, not a runtime state', () => {
        const development = { ...byId('living-himalaya'), status: 'development' };
        expect(observatoryRuntimeBadge(development, { value: 'OFFLINE', state: 'offline' }, statusLabel('development')))
            .toEqual({ text: 'IN DEVELOPMENT', state: 'declared', runtimeBound: false });
    });

    it('LOT 21: live child without a gateway (Living Himalaya): no runtime badge unless mounted', () => {
        const himalaya = byId('living-himalaya');
        expect(himalaya.status).toBe('live');
        expect(isMountOnlyRuntime(himalaya)).toBe(true);
        expect(isMountOnlyRuntime(byId('living-earth'))).toBe(false);
        expect(isMountOnlyRuntime(byId('living-protein'))).toBe(false);
        const notRunning = { text: 'NOT RUNNING', state: 'declared', runtimeBound: false };
        expect(observatoryRuntimeBadge(himalaya, null)).toEqual(notRunning);
        expect(observatoryRuntimeBadge(himalaya, { value: 'OFFLINE', state: 'offline', phase: 'idle' })).toEqual(notRunning); // never mounted
        expect(observatoryRuntimeBadge(himalaya, { value: 'OFFLINE', state: 'offline', phase: 'cancelled' })).toEqual(notRunning); // unmounted
        expect(observatoryRuntimeBadge(himalaya, { value: 'LIVE', state: 'live', phase: 'ready' })).toEqual({ text: 'LIVE', state: 'live', runtimeBound: true });
        expect(observatoryRuntimeBadge(himalaya, { value: 'FALLBACK', state: 'fallback', phase: 'ready' })).toEqual({ text: 'FALLBACK', state: 'fallback', runtimeBound: true });
        expect(observatoryRuntimeBadge(himalaya, { value: 'FALLBACK', state: 'fallback', phase: 'loading' }).runtimeBound).toBe(true);
        expect(isMountedRuntime({ phase: 'error' })).toBe(true); // a failed mount keeps its OFFLINE badge
        // Earth and Protein unchanged: a record in any phase is a runtime badge.
        expect(observatoryRuntimeBadge(byId('living-earth'), { value: 'FALLBACK', state: 'fallback', phase: 'idle' })).toEqual({ text: 'FALLBACK', state: 'fallback', runtimeBound: true });
    });

    it('keeps real runtime states for routed observatories, OFFLINE included', () => {
        expect(observatoryRuntimeBadge(byId('living-earth'), { value: 'OFFLINE', state: 'offline' }))
            .toEqual({ text: 'OFFLINE', state: 'offline', runtimeBound: true });
        expect(observatoryRuntimeBadge(byId('living-protein'), null)).toEqual({ text: 'FALLBACK', state: 'fallback', runtimeBound: true });
    });

    it('no record without a route reaches OFFLINE anywhere in the registry', () => {
        for (const item of OBSERVATORY_REGISTRY.filter((entry) => !hasRuntime(entry))) {
            expect(observatoryRuntimeBadge(item, { value: 'OFFLINE', state: 'offline' }, statusLabel(item.status)).text).not.toBe('OFFLINE');
        }
    });
});

describe('runtime store tracks routed observatories only', () => {
    let observatoryRuntime;
    beforeAll(async () => {
        globalThis.document ??= { querySelectorAll: () => [], dispatchEvent: () => true };
        ({ observatoryRuntime } = await import('../src/core/observatory-runtime-store.js'));
    });

    it('has records for the routed observatories only', () => {
        expect(Object.keys(observatoryRuntime.snapshot()).sort()).toEqual(['living-earth', 'living-himalaya', 'living-protein']);
        expect(observatoryRuntime.get('network-pulse')).toBeNull();
    });

    it('ignores a runtime write for a record without a route (e.g. an old diagnostic replay)', () => {
        expect(observatoryRuntime.set('living-ocean', 'offline')).toBeNull();
        expect(observatoryRuntime.get('living-ocean')).toBeNull();
        expect(observatoryRuntime.set('living-earth', 'live').value).toBe('LIVE');
    });
});
