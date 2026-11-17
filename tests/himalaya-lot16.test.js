// Himalaya LOT 16 — card and capabilities brought up to date (metadata only).
// Capabilities in the same form as Earth/Protein; every claimed capability
// names registered sources the observatory declares; nothing unmeasured or
// not yet built is claimed.
import { describe, expect, it } from 'vitest';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { OBSERVATORY_REGISTRY } from '../src/config/observatory-registry.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import {
  CAPABILITY_DEFINITIONS, OBSERVATORY_CAPABILITIES, OBSERVATORY_CAPABILITY_EVIDENCE, OBSERVATORY_UNMEASURED,
} from '../src/config/capability-registry.js';
import { validateObservatoryRegistry } from '../src/core/observatory/module-contract.js';
import { platformRegistry } from '../src/core/platform-registry.js';
import { describeCapabilityContract, evidenceSourceLabels } from '../src/atlas/capability-inspector.js';

const himalaya = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya');
const options = {
  taxonomy: PLATFORM_TAXONOMY, sourceDefinitions: SOURCE_DEFINITIONS, capabilityDefinitions: CAPABILITY_DEFINITIONS,
  observatoryCapabilities: OBSERVATORY_CAPABILITIES, observatoryCapabilityEvidence: OBSERVATORY_CAPABILITY_EVIDENCE,
};

describe('LOT 16: Living Himalaya capabilities', () => {
  it('the registry (with the evidence map) passes the module contract', () => {
    const report = validateObservatoryRegistry(OBSERVATORY_REGISTRY, options);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    expect(platformRegistry.getModuleContract().valid).toBe(true);
  });

  it('declares only data, provenance, historical time and live layers (same capability ids as Earth/Protein)', () => {
    expect(platformRegistry.getCapabilities('living-himalaya')).toEqual(['data', 'provenance', 'historical-time', 'live-layers']);
    for (const id of platformRegistry.getCapabilities('living-himalaya')) expect(platformRegistry.getCapability(id)).not.toBeNull();
    for (const id of ['story', 'vertical-export', 'still-export', 'video-export', 'diagnostic-replay']) expect(platformRegistry.hasCapability('living-himalaya', id)).toBe(false);
    // Earth and Protein are unchanged.
    expect(OBSERVATORY_CAPABILITIES['living-earth']).toHaveLength(8);
    expect(OBSERVATORY_CAPABILITIES['living-protein']).toEqual(['data', 'provenance', 'story', 'diagnostic-replay']);
  });

  it('every claimed capability names registered sources that the observatory declares, with their provenance', () => {
    for (const id of platformRegistry.getCapabilities('living-himalaya')) {
      const evidence = platformRegistry.getCapabilityEvidence('living-himalaya', id);
      expect(evidence?.sources?.length, id).toBeGreaterThan(0);
      for (const sourceId of evidence.sources) {
        expect(SOURCE_DEFINITIONS[sourceId], sourceId).toBeTruthy();
        expect(himalaya.sources, sourceId).toContain(sourceId);
      }
      expect(evidenceSourceLabels(evidence.sources)).toHaveLength(evidence.sources.length);
    }
    const provenances = new Set(platformRegistry.getCapabilityEvidence('living-himalaya', 'data').sources.map((s) => SOURCE_DEFINITIONS[s].provenance));
    expect([...provenances].sort()).toEqual(['interpretive', 'observed', 'physical-model', 'prediction', 'reconstructed', 'reported']);
    expect(evidenceSourceLabels(['sentinel2L2a'])[0]).toMatch(/\(observed\)$/);
    expect(evidenceSourceLabels(['himalayaRoutes'])[0]).toMatch(/\(interpretive\)$/);
  });

  it('the contract rejects a claim without a source, an unknown source or an undeclared one', () => {
    const bad = (evidence) => validateObservatoryRegistry(OBSERVATORY_REGISTRY, { ...options, observatoryCapabilityEvidence: { 'living-himalaya': evidence } }).errors.map((e) => e.code);
    const ok = OBSERVATORY_CAPABILITY_EVIDENCE['living-himalaya'];
    expect(bad({ ...ok, 'live-layers': { sources: [] } })).toContain('capability-without-source');
    expect(bad({ ...ok, 'live-layers': { sources: ['noSuchSource'] } })).toContain('unknown-evidence-source');
    expect(bad({ ...ok, 'live-layers': { sources: ['usgs'] } })).toContain('undeclared-evidence-source');
    expect(bad({ ...ok, story: { sources: ['astronomy'] } })).toContain('evidence-without-capability');
  });

  it('declares what is not measured, and claims nothing deferred or not started', () => {
    expect(OBSERVATORY_UNMEASURED['living-himalaya'].join(' ')).toMatch(/GTX 1650/);
    expect(OBSERVATORY_UNMEASURED['living-himalaya'].join(' ')).toMatch(/mobile devices/);
    const text = JSON.stringify({ capabilities: OBSERVATORY_CAPABILITY_EVIDENCE['living-himalaya'], roadmap: himalaya.roadmap }).toLowerCase();
    for (const word of ['garmin', 'night sky', 'star', 'glacier']) expect(text, word).not.toContain(word);
  });

  it('inspector: development contract with capabilities; live and empty records unchanged', () => {
    expect(describeCapabilityContract(himalaya, platformRegistry.getCapabilities('living-himalaya'))).toMatchObject({ label: 'Development contract', state: 'development' });
    const earth = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-earth');
    expect(describeCapabilityContract(earth, platformRegistry.getCapabilities('living-earth'))).toEqual({ label: 'Live contract', state: 'live', summary: '8 capabilities are explicitly declared by this observatory contract.' });
    const cell = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-cell');
    expect(describeCapabilityContract(cell, [])).toEqual({ label: 'No runtime claim', state: 'declared', summary: 'This roadmap record has no runtime capability declared yet.' });
  });

  it('card: stage and next threshold up to date; progress unchanged (pending decision)', () => {
    expect(himalaya.roadmap.stage).toBe('In development: terrain, Sentinel-2, Sun & Moon, summit weather, Himalayan Database history, optional routes & camps');
    expect(himalaya.roadmap.next).toBe('Finishing lot: Lhotse route line, camp labels hidden by terrain, checked camp elevations');
    expect(himalaya.roadmap.next).not.toMatch(/Per-field provenance/);
    expect(himalaya.roadmap.progress).toBe(60);
  });
});
