import { platformRegistry } from '../core/platform-registry.js';
import { atlasStatus } from '../core/status-store.js';

function formatSourceTime(value) {
  if (!value) return 'No live timestamp available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toISOString().slice(0, 10)} · ${date.toISOString().slice(11, 19)} UTC`;
}

function formatDuration(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)} min`;
  return `${(value / 3_600_000).toFixed(1)} h`;
}

function formatFreshness(status) {
  const freshness = status.freshness || 'not measured';
  const cache = status.cache || 'none';
  const age = Number.isFinite(status.cacheAgeMs) ? ` · age ${formatDuration(status.cacheAgeMs)}` : '';
  return `${freshness} · ${cache}${age}`;
}

function formatDiagnostics(status) {
  const parts = [];
  if (status.phase) parts.push(status.phase);
  if (status.networkState) parts.push(status.networkState);
  if (Number.isFinite(status.latencyMs)) parts.push(`${status.latencyMs} ms`);
  if (Number.isFinite(status.attempts) && status.attempts > 0) parts.push(`${status.attempts} attempt${status.attempts === 1 ? '' : 's'}`);
  if (status.reason) parts.push(status.reason);
  return parts.length ? parts.join(' · ') : 'Not executed by this index';
}

export function initSourceInspector() {
  const topology = document.getElementById('provenanceTopology');
  const workbench = document.getElementById('provenanceWorkbench');
  const inspector = document.getElementById('sourceInspector');
  const inspectorClose = document.getElementById('sourceInspectorClose');
  const inspectorTitle = document.getElementById('sourceInspectorTitle');
  const inspectorStatus = document.getElementById('sourceInspectorStatus');
  const inspectorUpdated = document.getElementById('sourceInspectorUpdated');
  const inspectorEndpoint = document.getElementById('sourceInspectorEndpoint');
  const inspectorType = document.getElementById('sourceInspectorType');
  const inspectorProcess = document.getElementById('sourceInspectorProcess');
  const inspectorScope = document.getElementById('sourceInspectorScope');
  const inspectorFreshness = document.getElementById('sourceInspectorFreshness');
  const inspectorDiagnostics = document.getElementById('sourceInspectorDiagnostics');
  const inspectorObservatories = document.getElementById('sourceInspectorObservatories');
  const inspectorVisuals = document.getElementById('sourceInspectorVisuals');
  let selectedSource = null;

  function renderInspector(key) {
    const definition = atlasStatus.getSourceDefinition(key);
    if (!definition || !inspector) return;
    const status = atlasStatus.getSourceStatus(key);
    selectedSource = key;
    workbench?.classList.add('has-inspector');
    inspector.setAttribute('aria-hidden', 'false');
    inspector.inert = false;

    document.querySelectorAll('.provenance-flow').forEach((flow) => {
      const active = flow.dataset.source === key;
      flow.classList.toggle('is-selected', active);
      flow.setAttribute('aria-pressed', String(active));
    });

    inspectorTitle.textContent = definition.title;
    inspectorStatus.textContent = status.value;
    inspectorStatus.dataset.state = status.state;
    inspectorUpdated.textContent = formatSourceTime(status.sourceTime || status.updated);
    inspectorEndpoint.textContent = definition.endpoint;
    inspectorType.textContent = definition.type;
    inspectorProcess.textContent = definition.process;
    inspectorScope.textContent = definition.scope;
    if (inspectorFreshness) inspectorFreshness.textContent = formatFreshness(status);
    if (inspectorDiagnostics) inspectorDiagnostics.textContent = formatDiagnostics(status);

    if (inspectorObservatories) {
      const consumers = (definition.observatories || [])
        .map((id) => platformRegistry.getObservatory(id)?.title)
        .filter(Boolean);
      inspectorObservatories.textContent = consumers.length ? consumers.join(' · ') : 'Gateway only';
    }

    inspectorVisuals.replaceChildren(
      ...definition.visuals.map((item) => {
        const listItem = document.createElement('li');
        listItem.textContent = item;
        return listItem;
      }),
    );

    if (window.matchMedia('(max-width:1080px)').matches) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => {
        inspector.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      });
    }
  }

  function closeInspector({ returnFocus = false } = {}) {
    const active = document.querySelector(`.provenance-flow[data-source="${selectedSource}"]`);
    selectedSource = null;
    workbench?.classList.remove('has-inspector');
    inspector?.setAttribute('aria-hidden', 'true');
    if (inspector) inspector.inert = true;
    document.querySelectorAll('.provenance-flow').forEach((flow) => {
      flow.classList.remove('is-selected');
      flow.setAttribute('aria-pressed', 'false');
    });
    if (returnFocus) active?.focus({ preventScroll: true });
  }

  topology?.addEventListener('click', (event) => {
    const flow = event.target.closest('.provenance-flow');
    if (flow) renderInspector(flow.dataset.source);
  });
  inspectorClose?.addEventListener('click', () => closeInspector({ returnFocus: true }));

  document.querySelectorAll('[data-provenance-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.provenanceFilter;
      document.querySelectorAll('[data-provenance-filter]').forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      document.querySelectorAll('.provenance-flow').forEach((flow) => {
        const domains = (flow.dataset.domains || '').split(/\s+/);
        flow.hidden = filter !== 'all' && !domains.includes(filter);
      });
      if (selectedSource) {
        const selected = document.querySelector(`.provenance-flow[data-source="${selectedSource}"]`);
        if (selected?.hidden) closeInspector();
      }
    });
  });

  document.addEventListener('lumi:source-status', (event) => {
    if (event.detail.key === selectedSource) renderInspector(selectedSource);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedSource) closeInspector({ returnFocus: true });
  });

  atlasStatus.broadcastInitialSourceStatus();
}
