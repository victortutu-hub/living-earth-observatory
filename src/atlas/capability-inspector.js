import { platformRegistry } from '../core/platform-registry.js?v=capabilityInspector1';

const GROUP_LABELS = Object.freeze({
  data: 'Data & provenance',
  time: 'Time',
  experience: 'Story',
  export: 'Export',
  runtime: 'Runtime',
});

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
    state.textContent = observatory.status === 'live' ? 'Live contract' : 'No runtime claim';
    state.dataset.state = observatory.status === 'live' ? 'live' : 'declared';
    summary.textContent = capabilities.length
      ? `${capabilities.length} capabilities are explicitly declared by this observatory contract.`
      : 'This roadmap record has no runtime capability declared yet.';

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
        return item;
      }));
      block.append(items);
      return block;
    });

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
