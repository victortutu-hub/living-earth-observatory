// Living Himalaya LOT 2: below 760 px the details panel becomes a bottom
// sheet with three states (collapsed / half / expanded). The toggle button
// carries aria-expanded (false only when collapsed) and aria-controls.
export const SHEET_STATES = Object.freeze(['collapsed', 'half', 'expanded']);
export const SHEET_MEDIA_QUERY = '(max-width: 760px)';

export function nextSheetState(state) {
  const i = SHEET_STATES.indexOf(state);
  return SHEET_STATES[(i + 1) % SHEET_STATES.length] || 'collapsed';
}

export function sheetAriaExpanded(state) {
  return state === 'collapsed' ? 'false' : 'true';
}

export function sheetLabel(state) {
  return state === 'collapsed' ? 'Show details' : state === 'half' ? 'Expand details' : 'Collapse details';
}

/**
 * @param {{panel:HTMLElement, toggle:HTMLButtonElement, media?:MediaQueryList, signal?:AbortSignal}} options
 */
export function createBottomSheet({ panel, toggle, media = window.matchMedia(SHEET_MEDIA_QUERY), signal = null, onChange = () => {} }) {
  let state = 'collapsed';
  function apply() {
    const active = media.matches;
    panel.classList.toggle('is-sheet', active);
    for (const s of SHEET_STATES) panel.classList.toggle(`is-${s}`, active && s === state);
    toggle.hidden = !active;
    toggle.setAttribute('aria-expanded', active ? sheetAriaExpanded(state) : 'true');
    toggle.setAttribute('aria-label', sheetLabel(state));
    toggle.dataset.state = state;
    onChange(state);
  }
  const onToggle = () => { state = nextSheetState(state); apply(); };
  const onMedia = () => apply();
  toggle.addEventListener('click', onToggle, { signal: signal || undefined });
  media.addEventListener?.('change', onMedia);
  apply();
  return {
    get state() { return state; },
    setState(next) { if (SHEET_STATES.includes(next)) { state = next; apply(); } },
    /** Opens to half height when a summit is chosen, without collapsing an expanded sheet. */
    reveal() { if (state === 'collapsed') { state = 'half'; apply(); } },
    dispose() {
      toggle.removeEventListener('click', onToggle);
      media.removeEventListener?.('change', onMedia);
    },
  };
}
