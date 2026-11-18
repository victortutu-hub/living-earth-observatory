import { platformRegistry } from '../core/platform-registry.js';
import { SOURCE_DEFINITIONS } from '../config/source-registry.js';
import { describeMeasuredRun } from '../config/capability-registry.js';

const GROUP_LABELS = Object.freeze({
  data: 'Data & provenance',
  time: 'Time',
  experience: 'Story',
  export: 'Export',
  runtime: 'Runtime',
});

/**
 * State line and summary of the inspector. A live observatory has a live
 * contract; an observatory in development that declares capabilities has a
 * development contract (each capability lists its sources); otherwise there
 * is no runtime claim.
 */
export function describeCapabilityContract(observatory, capabilities = []) {
  if (observatory?.status === 'live') {
    return { label: 'Live contract', state: 'live', summary: capabilities.length ? `${capabilities.length} capabilities are explicitly declared by this observatory contract.` : 'This roadmap record has no runtime capability declared yet.' };
  }
  if (observatory?.status === 'development' && capabilities.length) {
    return { label: 'Development contract', state: 'development', summary: `${capabilities.length} capabilities are declared for this observatory in development; each names the registered sources behind it.` };
  }
  return { label: 'No runtime claim', state: 'declared', summary: 'This roadmap record has no runtime capability declared yet.' };
}

/** "Title (provenance)" for each registered source id; unknown ids are dropped. */
export function evidenceSourceLabels(sourceIds = [], sources = SOURCE_DEFINITIONS) {
  return sourceIds.filter((id) => sources[id]).map((id) => `${sources[id].title} (${sources[id].provenance})`);
}

function createElement(tag, className, textContent) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent !== undefined) element.textContent = textContent;
  return element;
}

export function initCapabilityInspector() {
  const atlas = document.getElementById('observatoryAtlasGrid');
  const inspector = document.getElementById('capabilityInspector');
  const closeButton = document.getElementById('capabilityInspectorClose');
  const title = document.getElementById('capabilityInspectorTitle');
  const state = document.getElementById('capabilityInspectorState');
  const summary = document.getElementById('capabilityInspectorSummary');
  const list = document.getElementById('capabilityInspectorList');
  let selectedId = null;

  function close({ returnFocus = false } = {}) {
    const trigger = selectedId
      ? atlas?.querySelector(`[data-capability-inspect="${selectedId}"]`)
      : null;
    selectedId = null;
    inspector?.setAttribute('aria-hidden', 'true');
    if (inspector) inspector.inert = true;
    atlas?.querySelectorAll('.obs-card').forEach((card) => card.classList.remove('is-capability-selected'));
    if (returnFocus) trigger?.focus({ preventScroll: true });
  }

  function render(observatoryId) {
    const observatory = platformRegistry.getObservatory(observatoryId);
    if (!observatory || !inspector || !list) return;

    selectedId = observatoryId;
    const capabilities = platformRegistry.getCapabilities(observatoryId);
    title.textContent = `${observatory.title} capabilities`;
    const contract = describeCapabilityContract(observatory, capabilities);
    state.textContent = contract.label;
    state.dataset.state = contract.state;
    summary.textContent = contract.summary;

    const grouped = capabilities.reduce((result, capabilityId) => {
      const definition = platformRegistry.getCapability(capabilityId);
      if (!definition) return result;
      const group = definition.group || 'runtime';
      if (!result.has(group)) result.set(group, []);
      result.get(group).push(definition);
      return result;
    }, new Map());

    const groups = [...grouped.entries()].map(([group, definitions]) => {
      const block = createElement('section', 'capability-group');
      block.append(createElement('span', 'capability-group-label', GROUP_LABELS[group] || group));
      const items = createElement('ul', 'capability-list');
      items.append(...definitions.map((definition) => {
        const item = createElement('li');
        const label = createElement('strong', null, definition.label);
        const description = createElement('span', null, definition.description);
        item.append(label, description);
        const limits = platformRegistry.getCapabilityLimits(observatoryId, definition.id);
        if (limits) item.append(createElement('span', 'capability-evidence-note', `Limits: ${limits}`));
        const evidence = platformRegistry.getCapabilityEvidence(observatoryId, definition.id);
        if (evidence) {
          if (evidence.note) item.append(createElement('span', 'capability-evidence-note', evidence.note));
          item.append(createElement('span', 'capability-evidence', `Sources: ${evidenceSourceLabels(evidence.sources).join(' · ')}`));
        }
        return item;
      }));
      block.append(items);
      return block;
    });

    // Lot 16: the checklist behind a computed progress.
    const criteria = observatory.roadmap?.progressSource === 'criteria' ? observatory.roadmap.criteria : null;
    if (criteria?.length) {
      const done = criteria.filter((item) => item.done).length;
      const block = createElement('section', 'capability-group capability-group-criteria');
      block.append(createElement('span', 'capability-group-label', `Progress criteria · ${done} of ${criteria.length} (${observatory.roadmap.progress}%)`));
      const items = createElement('ul', 'capability-list');
      items.append(...criteria.map((item) => {
        const li = createElement('li', item.done ? 'is-done' : 'is-open', `${item.done ? '✓' : '○'} ${item.label}`);
        li.dataset.criterion = item.id;
        return li;
      }));
      block.append(items);
      groups.push(block);
    }

    // LOT 20: real-device runs (primary first), with the reports' location.
    const measured = platformRegistry.getMeasured?.(observatoryId) || [];
    if (measured.length) {
      const block = createElement('section', 'capability-group capability-group-measured');
      block.append(createElement('span', 'capability-group-label', 'Measured'));
      const items = createElement('ul', 'capability-list');
      items.append(...measured.filter((run) => run.primary).map((run) => createElement('li', null, describeMeasuredRun(run))));
      block.append(items);
      const secondary = measured.filter((run) => !run.primary);
      const note = [
        'Reports (schema lumi-himalaya-perf/1, ?perf=1 mode) are versioned in the repository under docs/perf/ with their SHA-256; they are not published on the site.',
        ...secondary.map((run) => `Also measured: ${run.note}`),
      ].join(' ');
      block.append(createElement('p', 'capability-evidence-note', note));
      groups.push(block);
    }

    const unmeasured = platformRegistry.getUnmeasured(observatoryId);
    if (unmeasured.length) {
      const block = createElement('section', 'capability-group capability-group-unmeasured');
      block.append(createElement('span', 'capability-group-label', 'Not measured'));
      const items = createElement('ul', 'capability-list');
      items.append(...unmeasured.map((text) => createElement('li', null, text)));
      block.append(items);
      groups.push(block);
    }

    list.replaceChildren(...(groups.length ? groups : [
      createElement('p', 'capability-empty', 'The module is mapped in the platform taxonomy, but it does not yet claim an active runtime contract.'),
    ]));

    inspector.setAttribute('aria-hidden', 'false');
    inspector.inert = false;
    atlas?.querySelectorAll('.obs-card').forEach((card) => {
      card.classList.toggle('is-capability-selected', card.dataset.observatoryId === observatoryId);
    });

    if (window.matchMedia('(max-width: 1080px)').matches) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => inspector.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' }));
    }
  }

  atlas?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-capability-inspect]');
    if (trigger) render(trigger.dataset.capabilityInspect);
  });
  closeButton?.addEventListener('click', () => close({ returnFocus: true }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedId) close({ returnFocus: true });
  });

  const syncWithAtlas = () => {
    if (!selectedId) return;
    const trigger = atlas?.querySelector(`[data-capability-inspect="${selectedId}"]`);
    if (!trigger) {
      close();
      return;
    }
    trigger.closest('.obs-card')?.classList.add('is-capability-selected');
  };
  document.addEventListener('lumi:observatory-atlas-rendered', syncWithAtlas);

  return {
    dispose: () => {
      document.removeEventListener('lumi:observatory-atlas-rendered', syncWithAtlas);
      close();
    },
  };
}
