import { describe, expect, it } from 'vitest';
import {
  PROVENANCE_LABELS,
  PROVENANCE_TYPES,
  SOURCE_DEFINITIONS,
  INITIAL_SOURCE_STATUS,
  describeSourceProvenance,
} from '../src/config/source-registry.js';
import { composeProvenanceStatus, composeSourceStatus, formatTemporalBadge } from '../src/earth/temporal-provenance.js';
import { auroraPlugin } from '../src/earth/layers/aurora.js';
import { snowIcePlugin } from '../src/earth/layers/snow-ice.js';
import { gvpVolcanoesPlugin } from '../src/earth/layers/gvp-volcanoes.js';
import { buildPluginTooltip } from '../src/earth/layer-plugin-registry.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';

const EXPECTED = {
  eonet: 'observed',
  usgs: 'observed',
  firms: 'observed',
  gibs: 'observed', // snow-ice (GIBS)
  gvp: 'observed',
  ovation: 'prediction',
  openMeteo: 'prediction',
  openMeteoMarine: 'prediction',
  celestrak: 'physical-model', // ISS
  astronomy: 'physical-model', // Sun, Moon
  gdacs: 'interpretive',
  airglow: 'interpretive',
  zodiacal: 'interpretive',
  noctilucent: 'interpretive',
};

describe('canonical provenance vocabulary (AGENTS.md)', () => {
  it('exports exactly the AGENTS.md vocabulary with a label for each value', () => {
    expect(PROVENANCE_TYPES).toEqual(['observed', 'reconstructed', 'physical-model', 'simulation', 'prediction', 'interpretive', 'fallback']);
    expect(Object.keys(PROVENANCE_LABELS).sort()).toEqual([...PROVENANCE_TYPES].sort());
    expect(PROVENANCE_LABELS.prediction).toBe('Model prediction');
  });

  it('gives every source a canonical provenance, a tooltip note and an initial status', () => {
    for (const [key, definition] of Object.entries(SOURCE_DEFINITIONS)) {
      expect(PROVENANCE_TYPES, key).toContain(definition.provenance);
      expect(definition.provenanceNote, key).toBeTruthy();
      expect(INITIAL_SOURCE_STATUS[key], key).toBeTruthy();
    }
  });

  it('applies the agreed mapping', () => {
    for (const [key, provenance] of Object.entries(EXPECTED)) {
      expect(SOURCE_DEFINITIONS[key]?.provenance, key).toBe(provenance);
    }
  });

  it('keeps accessClass as a separate axis', () => {
    expect(SOURCE_DEFINITIONS.astronomy.accessClass).toBe('physical-model');
    expect(SOURCE_DEFINITIONS.gvp.accessClass).toBe('proxy-only');
    expect(SOURCE_DEFINITIONS.openMeteo.accessClass).toBe('public');
  });

  it('names the source and its nature in the tooltip', () => {
    expect(describeSourceProvenance('gdacs').title).toContain('Event reported; alert level estimated by the GDACS impact model');
    expect(describeSourceProvenance('openMeteo', { validAt: '2026-11-11T14:00:00Z' }).title)
      .toContain('Open-Meteo model forecast, valid at 2026-11-11 14:00 UTC');
    expect(describeSourceProvenance('openMeteoMarine', { validAt: '2026-11-11T14:00:00Z' }).title)
      .toContain('Open-Meteo model forecast, valid at 2026-11-11 14:00 UTC');
    expect(describeSourceProvenance('missing')).toBeNull();
  });
});

describe('layer plugins read provenance from the source registry', () => {
  it.each([
    [auroraPlugin, 'ovation', 'prediction'],
    [snowIcePlugin, 'gibs', 'observed'],
    [gvpVolcanoesPlugin, 'gvp', 'observed'],
  ])('%s.id uses its source provenance', (plugin, sourceKey, provenance) => {
    expect(plugin.sourceKey).toBe(sourceKey);
    expect(plugin).not.toHaveProperty('provenance');
    expect(describeSourceProvenance(plugin.sourceKey).provenance).toBe(provenance);
  });
});

describe('no "Observed" label on prediction or interpretive sources', () => {
  const nonObserved = Object.entries(SOURCE_DEFINITIONS)
    .filter(([, definition]) => ['prediction', 'interpretive'].includes(definition.provenance))
    .map(([key]) => key);

  it.each(nonObserved)('%s', (sourceKey) => {
    const data = composeSourceStatus({
      sourceKey,
      message: 'Layer: on',
      dataTime: '2026-11-11T14:00:00Z',
      validAt: '2026-11-11T14:00:00Z',
      fetchedAt: '2026-11-11T14:05:00Z',
      now: Date.parse('2026-11-11T14:10:00Z'),
    });
    const local = composeProvenanceStatus(sourceKey, 'Layer: on');
    for (const text of [data.message, data.title, local.message, local.title]) {
      expect(text).not.toMatch(/\bObserved\b/);
    }
    expect(data.message.startsWith(`${PROVENANCE_LABELS[SOURCE_DEFINITIONS[sourceKey].provenance]} · `)).toBe(true);
  });

  it('the temporal badge no longer defaults to "Observed"', () => {
    expect(formatTemporalBadge({ temporalType: 'observed-derived', sceneTimeCompatibility: 'latest-only' })).not.toMatch(/Observed/);
  });
});

describe('composed tooltips', () => {
  it.each([auroraPlugin, snowIcePlugin, gvpVolcanoesPlugin])('$id button tooltip has no double period', (plugin) => {
    const tooltip = buildPluginTooltip(plugin);
    expect(tooltip).not.toMatch(/\.\./);
    expect(tooltip).toContain(plugin.license.replace(/\.$/, ''));
    expect(tooltip).toContain(describeSourceProvenance(plugin.sourceKey).title);
    expect(tooltip.endsWith('.')).toBe(true);
  });

  it('adds exactly one period to sentences that lack one', () => {
    const tooltip = buildPluginTooltip({ attribution: 'A', license: 'License without period', sourceKey: 'gvp' });
    expect(tooltip.startsWith('A - License without period. Smithsonian GVP — Observed:')).toBe(true);
    expect(tooltip).not.toMatch(/\.\./);
  });
});

describe('Living Earth module lists every source it consumes', () => {
  it('matches the sources whose definitions name living-earth', () => {
    const livingEarth = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-earth');
    const declared = Object.entries(SOURCE_DEFINITIONS)
      .filter(([, definition]) => definition.observatories.includes('living-earth'))
      .map(([key]) => key)
      .sort();
    expect([...livingEarth.sources].sort()).toEqual(declared);
    for (const key of ['openMeteo', 'openMeteoMarine', 'gvp', 'airglow', 'zodiacal', 'noctilucent']) {
      expect(livingEarth.sources).toContain(key);
    }
  });
});
