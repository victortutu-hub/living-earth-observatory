import { getDefaultGatewaySlot } from './gateway-slots.js';

export function syncGatewayDom(slots) {
  slots.forEach((slot) => {
    const label = document.querySelector(`[data-portal-label="${slot.id}"]`);
    const item = slot.observatory;
    if (!label || !item) return;
    const title = label.querySelector('.portal-title');
    const subtitle = label.querySelector('.small');
    const description = label.querySelector('p');
    if (title) title.textContent = item.title;
    if (subtitle) subtitle.textContent = item.subtitle;
    if (description) description.textContent = item.portalDescription || item.description;
    label.dataset.observatoryId = item.id;
    label.style.setProperty('--portal-primary-rgb', slot.gateway.signature.cssPrimary);
    label.style.setProperty('--portal-secondary-rgb', slot.gateway.signature.cssSecondary);
  });

  const defaultSlot = getDefaultGatewaySlot(slots);
  const stage = document.getElementById('stage');
  const enterHint = document.getElementById('gatewayEnterHint');
  if (stage && defaultSlot?.observatory) {
    const item = defaultSlot.observatory;
    stage.setAttribute('aria-label', `Enter the ${item.title} ${item.subtitle} through its featured portal`);
  }
  if (enterHint && defaultSlot?.observatory) {
    enterHint.textContent = `Click or tap the ${defaultSlot.observatory.title} portal to enter`;
  }
}
