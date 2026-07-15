export const OBSERVATORY_CONTRACT_VERSION = '0.1.0';

const REQUIRED_FIELDS = Object.freeze([
  'id', 'title', 'family', 'scale', 'scaleAxis', 'status',
  'representations', 'sources', 'roadmap',
]);

function issue(level, code, message, field = null) {
  return Object.freeze({ level, code, message, field });
}

function createLookup(items) {
  return new Set((items || []).map((item) => item.id));
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateObservatoryModule(moduleDefinition, {
  taxonomy,
  sourceDefinitions = {},
  capabilityDefinitions = {},
  observatoryCapabilities = {},
} = {}) {
  const errors = [];
  const warnings = [];
  const module = moduleDefinition || {};
  const families = createLookup(taxonomy?.families);
  const scales = createLookup(taxonomy?.scales);
  const axes = createLookup(taxonomy?.scaleAxes);
  const conceptualScales = new Map((taxonomy?.conceptualScales || []).map((item) => [item.id, item]));
  const statuses = createLookup(taxonomy?.statuses);
  const representations = createLookup(taxonomy?.representations);

  REQUIRED_FIELDS.forEach((field) => {
    if (module[field] === undefined || module[field] === null) {
      errors.push(issue('error', 'missing-field', `Missing required module field: ${field}.`, field));
    }
  });

  if (!hasText(module.id)) errors.push(issue('error', 'invalid-id', 'Module id must be a non-empty string.', 'id'));
  if (!hasText(module.title)) errors.push(issue('error', 'invalid-title', 'Module title must be a non-empty string.', 'title'));
  if (!families.has(module.family)) errors.push(issue('error', 'unknown-family', `Unknown family: ${module.family}.`, 'family'));
  if (!scales.has(module.scale)) errors.push(issue('error', 'unknown-scale', `Unknown scale: ${module.scale}.`, 'scale'));
  if (!axes.has(module.scaleAxis)) errors.push(issue('error', 'unknown-scale-axis', `Unknown scale axis: ${module.scaleAxis}.`, 'scaleAxis'));
  if (!statuses.has(module.status)) errors.push(issue('error', 'unknown-status', `Unknown status: ${module.status}.`, 'status'));

  if (!Array.isArray(module.representations) || module.representations.length === 0) {
    errors.push(issue('error', 'invalid-representations', 'Module representations must be a non-empty array.', 'representations'));
  } else {
    module.representations.forEach((representation) => {
      if (!representations.has(representation)) {
        errors.push(issue('error', 'unknown-representation', `Unknown representation: ${representation}.`, 'representations'));
      }
    });
  }

  if (!Array.isArray(module.sources)) {
    errors.push(issue('error', 'invalid-sources', 'Module sources must be an array.', 'sources'));
  } else {
    module.sources.forEach((sourceId) => {
      if (!sourceDefinitions[sourceId]) {
        errors.push(issue('error', 'unknown-source', `Unknown source: ${sourceId}.`, 'sources'));
      }
    });
  }

  if (module.scaleAxis === 'physical' && module.conceptualScale) {
    warnings.push(issue('warning', 'physical-conceptual-scale', 'A physical-scale module should not declare a conceptual scale.', 'conceptualScale'));
  }

  if (module.scaleAxis !== 'physical') {
    const conceptualDefinition = conceptualScales.get(module.conceptualScale);
    if (!conceptualDefinition) {
      errors.push(issue('error', 'missing-conceptual-scale', 'A non-physical module needs a known conceptual scale.', 'conceptualScale'));
    } else if (conceptualDefinition.axis !== module.scaleAxis) {
      errors.push(issue('error', 'mismatched-conceptual-axis', 'Conceptual scale does not belong to the declared scale axis.', 'conceptualScale'));
    }
  }

  if (module.status === 'live' && !hasText(module.route)) {
    errors.push(issue('error', 'missing-live-route', 'A live module must declare an active route.', 'route'));
  }
  if (module.status !== 'live' && module.route) {
    warnings.push(issue('warning', 'future-route', 'A non-live module declares a route; keep it disabled until the observatory is ready.', 'route'));
  }
  if (module.gateway?.enabled && module.status !== 'live') {
    errors.push(issue('error', 'gateway-non-live', 'Only live modules may be enabled in the gateway.', 'gateway'));
  }

  const capabilities = observatoryCapabilities[module.id] || [];
  if (!Array.isArray(capabilities)) {
    errors.push(issue('error', 'invalid-capabilities', 'Observatory capabilities must be an array.', 'capabilities'));
  } else {
    capabilities.forEach((capabilityId) => {
      if (!capabilityDefinitions[capabilityId]) {
        errors.push(issue('error', 'unknown-capability', `Unknown capability: ${capabilityId}.`, 'capabilities'));
      }
    });
  }

  return Object.freeze({
    id: module.id || null,
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  });
}

export function validateObservatoryRegistry(modules, options = {}) {
  const ids = new Set();
  const reports = (modules || []).map((module) => {
    const report = validateObservatoryModule(module, options);
    const duplicate = ids.has(module?.id);
    if (module?.id) ids.add(module.id);
    if (!duplicate) return report;

    return Object.freeze({
      ...report,
      valid: false,
      errors: Object.freeze([
        ...report.errors,
        issue('error', 'duplicate-id', `Duplicate observatory id: ${module.id}.`, 'id'),
      ]),
    });
  });
  const errors = reports.flatMap((report) => report.errors.map((entry) => ({ ...entry, moduleId: report.id })));
  const warnings = reports.flatMap((report) => report.warnings.map((entry) => ({ ...entry, moduleId: report.id })));

  return Object.freeze({
    version: OBSERVATORY_CONTRACT_VERSION,
    valid: errors.length === 0,
    modules: Object.freeze(reports),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  });
}
