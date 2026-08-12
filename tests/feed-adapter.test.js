import { describe, expect, it } from 'vitest';
import { shapeEvents } from '../src/core/feed-adapter.js';

describe('shapeEvents', () => {
    it('filters by age and category, sorts newest-first, and caps the count', () => {
        const now = Date.now();
        const event = (id, ageDays, category) => ({
            id,
            categories: [{ id: category }],
            geometry: [{ date: new Date(now - ageDays * 86_400_000).toISOString() }],
        });
        const result = shapeEvents([
            event('older', 3, 'wildfires'),
            event('newest', 1, 'wildfires'),
            event('different-category', 0.5, 'floods'),
            event('too-old', 30, 'wildfires'),
        ], { days: 7, category: 'wildfires', maxEvents: 1 });
        expect(result.map(item => item.id)).toEqual(['newest']);
    });
});
