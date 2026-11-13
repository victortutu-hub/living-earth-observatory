import { beforeAll, describe, expect, it } from 'vitest';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { hasRuntime, observatoryRuntimeBadge } from '../src/core/observatory-runtime-badge.js';

const statusLabel = (id) => PLATFORM_TAXONOMY.statuses.find((status) => status.id === id)?.label;
const byId = (id) => OBSERVATORY_REGISTRY.find((item) => item.id === id);

describe('runtime badge: planned observatories are not "offline"', () => {
    it('shows the registry status for records without a route', () => {
        expect(observatoryRuntimeBadge(byId('living-himalaya'), null, statusLabel('planned')))
            .toEqual({ text: 'PLANNED', state: 'declared', runtimeBound: false });
        expect(observatoryRuntimeBadge(byId('living-ocean'), { value: 'OFFLINE', state: 'offline' }, statusLabel('research')))
            .toEqual({ text: 'RESEARCH', state: 'declared', runtimeBound: false });
        expect(observatoryRuntimeBadge(byId('living-sun'), null, statusLabel('development')).text).toBe('IN DEVELOPMENT');
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
        expect(Object.keys(observatoryRuntime.snapshot()).sort()).toEqual(['living-earth', 'living-protein']);
        expect(observatoryRuntime.get('living-himalaya')).toBeNull();
    });

    it('ignores a runtime write for a record without a route (e.g. an old diagnostic replay)', () => {
        expect(observatoryRuntime.set('living-ocean', 'offline')).toBeNull();
        expect(observatoryRuntime.get('living-ocean')).toBeNull();
        expect(observatoryRuntime.set('living-earth', 'live').value).toBe('LIVE');
    });
});
