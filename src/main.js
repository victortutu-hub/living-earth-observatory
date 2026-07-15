import { PLATFORM_TAXONOMY } from './config/platform-taxonomy.js?v=taxonomyV4';
import { OBSERVATORY_REGISTRY } from './config/observatory-registry.js?v=taxonomyV4';
import { SOURCE_DEFINITIONS } from './config/source-registry.js?v=sourceInspectorV4';
import { platformRegistry } from './core/platform-registry.js?v=capabilityInspector1';
import { atlasStatus } from './core/status-store.js?v=sourceInspectorV4';
import { observatoryRuntime } from './core/observatory-runtime-store.js';
import { dataBroker } from './core/data-broker.js';
import { RUNTIME_STATE, RUNTIME_PHASE } from './core/runtime/runtime-states.js';
import { runtimeControl } from './core/runtime/runtime-control.js';
import { RUNTIME_RESOURCE_CATALOG } from './core/runtime/resource-catalog.js';
import { initObservatoryAtlas } from './atlas/observatory-atlas.js?v=provenanceModules1';
import { initCapabilityInspector } from './atlas/capability-inspector.js?v=capabilityInspector1';
import { initSourceInspector } from './atlas/source-inspector.js';
import { initTelemetry } from './atlas/telemetry.js';
import { initStoryRuntime } from './atlas/story-runtime.js';
import { initPortalRenderer } from './gateway/portal-renderer.js?v=atlasEarthMount3';
import { resolveGatewaySlots } from './gateway/gateway-slots.js';
import { listPortalAdapters } from './gateway/adapters/portal-adapter-registry.js';
import { listPortalMaterials } from './gateway/materials/material-registry.js';
import { initRuntimeControlCenter } from './control-center/runtime-control-center.js?v=runtimeControls3';
import { initObservatoryModuleController } from './atlas/observatory-module-controller.js?v=atlasEarthMount2';

function runSubsystem(name, initializer, disposables) {
  try {
    const result = initializer();
    if (result?.dispose) disposables.push(result.dispose);
    return result;
  } catch (error) {
    console.error(`[Luminomorphism] ${name} initialization failed.`, error);
    return null;
  }
}

function initialize() {
  const disposables = [];
  dataBroker.initialize().catch((error) => {
    console.warn('[Luminomorphism] Persistent cache initialization degraded.', error);
    atlasStatus.setStatus('cache', 'MEMORY ONLY', 'fallback');
  });

  runSubsystem('Observatory Atlas', initObservatoryAtlas, disposables);
  runSubsystem('Capability Inspector', initCapabilityInspector, disposables);
  runSubsystem('Source Inspector', initSourceInspector, disposables);
  runSubsystem('Telemetry', initTelemetry, disposables);
  runSubsystem('Story Runtime', initStoryRuntime, disposables);
  let moduleController = null;
  const portalRenderer = runSubsystem(
    'Portal Renderer',
    () => initPortalRenderer({ onActivate: (observatory, slot) => moduleController?.enter(observatory, slot) }),
    disposables,
  );
  moduleController = runSubsystem(
    'Observatory Module Controller',
    () => initObservatoryModuleController({ getPortalRenderer: () => portalRenderer }),
    disposables,
  );
  const runtimeCenter = runSubsystem(
    'Runtime Control Center',
    () => initRuntimeControlCenter({ dataBroker, portalRenderer }),
    disposables,
  );

  window.LUMINOMORPHISM = Object.freeze({
    taxonomy: PLATFORM_TAXONOMY,
    observatories: OBSERVATORY_REGISTRY,
    sources: SOURCE_DEFINITIONS,
    resources: RUNTIME_RESOURCE_CATALOG,
    platform: platformRegistry,
    modules: moduleController,
    status: atlasStatus,
    observatoryRuntime,
    data: dataBroker,
    runtime: Object.freeze({
      states: RUNTIME_STATE,
      phases: RUNTIME_PHASE,
      control: runtimeControl,
      center: runtimeCenter?.api || null,
      diagnostics: runtimeCenter?.api?.diagnostics || null,
    }),
    gateway: Object.freeze({
      slots: resolveGatewaySlots(),
      adapters: listPortalAdapters(),
      materials: listPortalMaterials(),
      renderer: portalRenderer,
    }),
  });

  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    disposables.splice(0).reverse().forEach((dispose) => {
      try { dispose(); } catch (error) { console.warn('[Luminomorphism] Disposal failed.', error); }
    });
    dataBroker.runtime.abortAll();
  }, { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
  initialize();
}
