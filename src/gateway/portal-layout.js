function smoothstep(a, b, value) {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function getPortalSlotGeometry(
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  slotCount = 2,
) {
  const aspect = viewportWidth / Math.max(viewportHeight, 1);
  const layout = smoothstep(1.15, 1.55, aspect);
  const radius = (1 - layout) * 0.24 + layout * 0.345;
  const normalizedCenters = slotCount <= 1
    ? [{ x: 0, y: 0.035 }]
    : [
        { x: layout * -0.54, y: (1 - layout) * 0.42 + layout * 0.035 },
        { x: layout * 0.54, y: (1 - layout) * -0.32 + layout * 0.035 },
      ];
  const toScreen = (center) => ({
    x: ((center.x / aspect) + 1) * 0.5 * viewportWidth,
    y: (1 - ((center.y + 1) * 0.5)) * viewportHeight,
  });
  const visibleOuterRadius = radius * 1.34 * viewportHeight * 0.5;
  const hitRadius = radius * 1.18 * viewportHeight * 0.5;

  return normalizedCenters.map((center, index) => ({
    id: `slot-${index}`,
    index,
    ...toScreen(center),
    normalizedX: center.x,
    normalizedY: center.y,
    radius,
    r: hitRadius,
    outerR: visibleOuterRadius,
  }));
}

export function positionPortalLabels({ labels, mobile, geometry = getPortalSlotGeometry() }) {
  const gap = mobile ? 10 : 16;
  geometry.forEach((portal) => {
    const label = labels.get(portal.id);
    if (!label) return;
    label.style.left = `${portal.x}px`;
    label.style.top = `${portal.y + portal.outerR + gap}px`;
  });
}
