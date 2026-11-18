// Himalaya LOT 16 — card and capabilities brought up to date (metadata only).
// Capabilities in the same form as Earth/Protein; every claimed capability
// names registered sources the observatory declares; nothing unmeasured or
// not yet built is claimed.
import { describe, expect, it } from 'vitest';
import { PLATFORM_TAXONOMY } from '../src/config/platform-taxonomy.js';
import { OBSERVATORY_REGISTRY, progressFromCriteria } from '../src/config/observatory-registry.js';
import { SOURCE_DEFINITIONS } from '../src/config/source-registry.js';
import {
  CAPABILITY_DEFINITIONS, OBSERVATORY_CAPABILITIES, OBSERVATORY_CAPABILITY_EVIDENCE, OBSERVATORY_UNMEASURED, OBSERVATORY_MEASURED,
} from '../src/config/capability-registry.js';
import { validateObservatoryRegistry } from '../src/core/observatory/module-contract.js';
import { platformRegistry } from '../src/core/platform-registry.js';
import { describeCapabilityContract, evidenceSourceLabels } from '../src/atlas/capability-inspector.js';

const himalaya = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-himalaya');
const options = {
  taxonomy: PLATFORM_TAXONOMY, sourceDefinitions: SOURCE_DEFINITIONS, capabilityDefinitions: CAPABILITY_DEFINITIONS,
  observatoryCapabilities: OBSERVATORY_CAPABILITIES, observatoryCapabilityEvidence: OBSERVATORY_CAPABILITY_EVIDENCE, observatoryMeasured: OBSERVATORY_MEASURED, // LOT 20
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
    expect(OBSERVATORY_CAPABILITIES['living-earth']).toHaveLength(9); // LOT 17: + historical-time
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
    // LOT 20: the GTX 1650 desktop and the real phone are measured now; what stays unmeasured is declared.
    expect(OBSERVATORY_UNMEASURED['living-himalaya'].join(' ')).toMatch(/120 Hz/);
    expect(OBSERVATORY_UNMEASURED['living-himalaya'].join(' ')).toMatch(/GPU time per frame on the phone/);
    // Claims only: capabilities, stage, next threshold and the criteria marked done (open criteria may name future work).
    // The next threshold names future work on purpose, so it is not a claim. LOT 15b: the real night sky
    // (criterion 10) now exists, so it is no longer a forbidden claim; GPS tracks and glaciers still are.
    const { stage, criteria } = himalaya.roadmap;
    const text = JSON.stringify({ capabilities: OBSERVATORY_CAPABILITY_EVIDENCE['living-himalaya'], stage, done: criteria.filter((c) => c.done) }).toLowerCase();
    for (const word of ['garmin', 'glacier']) expect(text, word).not.toContain(word);
  });

  it('inspector: live contract since LOT 21 (development contract before); live and empty records unchanged', () => {
    expect(describeCapabilityContract(himalaya, platformRegistry.getCapabilities('living-himalaya'))).toEqual({ label: 'Live contract', state: 'live', summary: '4 capabilities are explicitly declared by this observatory contract.' });
    expect(describeCapabilityContract({ ...himalaya, status: 'development' }, platformRegistry.getCapabilities('living-himalaya'))).toMatchObject({ label: 'Development contract', state: 'development' });
    const earth = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-earth');
    expect(describeCapabilityContract(earth, platformRegistry.getCapabilities('living-earth'))).toEqual({ label: 'Live contract', state: 'live', summary: '9 capabilities are explicitly declared by this observatory contract.' });
    const cell = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-cell');
    expect(describeCapabilityContract(cell, [])).toEqual({ label: 'No runtime claim', state: 'declared', summary: 'This roadmap record has no runtime capability declared yet.' });
  });

  it('card: stage and next threshold up to date; progress computed from the criteria', () => {
    expect(himalaya.roadmap.stage).toBe('Live: terrain, Sentinel-2, Sun & Moon, real sky, summit weather, Himalayan Database history, optional routes & camps; measured on GTX 1650 and a real phone'); // LOT 21
    expect(himalaya.roadmap.next).toBe('All criteria met — next: glaciers (research)'); // LOT 20
    expect(himalaya.roadmap.next).not.toMatch(/Per-field provenance/);
    expect(himalaya.roadmap.progress).toBe(100);
  });

  it('progress = round(100 · done / total) from exactly the 11 approved criteria (11 done since LOT 20)', () => {
    const { criteria } = himalaya.roadmap;
    expect(himalaya.roadmap.progressSource).toBe('criteria');
    expect(criteria.map((c) => c.label)).toEqual([
      'Real terrain (GLO-30 + Terrarium)', 'Observed image (Sentinel-2 L2A)', 'Real Sun & Moon', 'Summit weather (model)',
      'Summit history (Himalayan Database, approved aggregates)', 'Per-field provenance + source panel', 'Optional routes & camps',
      'Time from Earth + mobile bottom sheet', 'Finishing lot (Lhotse route, camp labels hidden by terrain, checked camp elevations)',
      'Real night sky (Lot 15b)', 'Measured performance (real GTX 1650, real mobile)',
    ]);
    expect(criteria.map((c) => c.done)).toEqual(Array(11).fill(true));
    expect(new Set(criteria.map((c) => c.id)).size).toBe(11);
    expect(progressFromCriteria(criteria)).toBe(100);
    expect(himalaya.roadmap.progress).toBe(100);
    expect(JSON.stringify(criteria).toLowerCase()).not.toMatch(/garmin|glacier/);
  });

  it('the contract rejects a hand-written progress next to criteria, and computed progress without criteria', () => {
    const withRoadmap = (roadmap) => OBSERVATORY_REGISTRY.map((item) => (item.id === 'living-himalaya' ? { ...item, roadmap } : item));
    const codes = (roadmap) => validateObservatoryRegistry(withRoadmap(roadmap), options).errors.map((e) => e.code);
    const { criteria, stage, next } = himalaya.roadmap;
    expect(codes({ progress: 60, stage, next, criteria })).toContain('manual-progress-with-criteria');
    expect(codes({ progress: 60, progressSource: 'criteria', stage, next, criteria })).toContain('manual-progress-with-criteria');
    expect(codes({ progress: 73, progressSource: 'criteria', stage, next })).toContain('criteria-progress-without-criteria');
    expect(codes({ progress: 73, progressSource: 'criteria', stage, next, criteria: [{ id: 'x', label: 'x', done: 'yes' }] })).toContain('invalid-progress-criteria');
    expect(codes(himalaya.roadmap)).toEqual([]);
  });

  // LOT 22: Earth and Protein are computed from criteria too (details in tests/lot22.test.js).
  it('Earth and Protein progress is computed from criteria (LOT 22)', () => {
    const earth = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-earth');
    const protein = OBSERVATORY_REGISTRY.find((item) => item.id === 'living-protein');
    expect(earth.roadmap).toMatchObject({ progress: 75, progressSource: 'criteria' }); // LOT 23 (67 in LOT 22)
    expect(protein.roadmap).toMatchObject({ progress: 58, progressSource: 'criteria' });
    expect(progressFromCriteria(earth.roadmap.criteria)).toBe(75);
    expect(progressFromCriteria(protein.roadmap.criteria)).toBe(58);
  });
});
