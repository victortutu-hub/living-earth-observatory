const MATERIALS = Object.freeze({
  'planetary-sphere': Object.freeze({ id: 'planetary-sphere', code: 0 }),
  'molecular-trace': Object.freeze({ id: 'molecular-trace', code: 1 }),
  'procedural-field': Object.freeze({ id: 'procedural-field', code: 2 }),
});

export function getPortalMaterial(materialId) {
  return MATERIALS[materialId] || MATERIALS['procedural-field'];
}

export function getPortalMaterialCode(materialId) {
  return getPortalMaterial(materialId).code;
}

export function listPortalMaterials() {
  return Object.values(MATERIALS);
}
