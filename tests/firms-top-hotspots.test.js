import { describe, expect, it } from 'vitest';
import { selectTopHotspots } from '../src/earth/firms-wildfires.js';

function hotspot(id, frp, confidence, date = '2026-11-11T10:00:00Z') {
  return { id, firms: { frp, confidence }, geometry: [{ date }] };
}

describe('FIRMS top hotspots', () => {
  it('sorts all eligible hotspots by FRP before truncating', () => {
    // The strongest fires arrive last in the feed order.
    const events = [
      hotspot('weak-1', 6, 'n'),
      hotspot('weak-2', 7, 'n'),
      hotspot('weak-3', 8, 'h'),
      hotspot('strong-1', 410, 'n'),
      hotspot('strong-2', 950, 'l'),
    ];
    const { selected, eligible } = selectTopHotspots(events, 2);
    expect(selected.map(event => event.id)).toEqual(['strong-2', 'strong-1']);
    expect(eligible).toBe(5);
  });

  it('breaks FRP ties by confidence rank, then by newest acquisition', () => {
    const events = [
      hotspot('nominal', 50, 'n', '2026-11-11T12:00:00Z'),
      hotspot('high-old', 50, 'h', '2026-11-11T08:00:00Z'),
      hotspot('high-new', 50, 'high', '2026-11-11T11:00:00Z'),
      hotspot('low', 50, 'l', '2026-11-11T13:00:00Z'),
    ];
    expect(selectTopHotspots(events, 4).selected.map(event => event.id))
      .toEqual(['high-new', 'high-old', 'nominal', 'low']);
  });

  it('does not mutate the input order', () => {
    const events = [hotspot('a', 1, 'n'), hotspot('b', 2, 'n')];
    selectTopHotspots(events, 1);
    expect(events.map(event => event.id)).toEqual(['a', 'b']);
  });
});
