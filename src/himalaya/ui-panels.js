// Living Himalaya LOT 5: collapsible desktop panels (summit list, summit
// details) with a button on each panel and the global "H" key, plus the
// one-line / expanded provenance bar. State kept for the session
// (sessionStorage "lumi-himalaya:ui-panels", every access in try/catch).
// Below 760 px nothing changes (the bottom sheet owns the layout).
export const PANEL_STORAGE_KEY = 'lumi-himalaya:ui-panels';
export const DEFAULT_PANEL_STATE = Object.freeze({ list: false, details: false, provenance: false }); // false = not collapsed / not expanded

export function readPanelState(storage) {
  try {
    const raw = storage?.getItem(PANEL_STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return {
      list: value?.list === true,
      details: value?.details === true,
      provenance: value?.provenance === true,
    };
  } catch (_) {
    return { ...DEFAULT_PANEL_STATE };
  }
}

export function writePanelState(storage, state) {
  try { storage?.setItem(PANEL_STORAGE_KEY, JSON.stringify({ list: Boolean(state.list), details: Boolean(state.details), provenance: Boolean(state.provenance) })); } catch (_) { /* private mode / quota: not kept */ }
}

/** "H" toggles both panels: if any is open, collapse both; otherwise open both. */
export function toggleAll(state) {
  const collapse = !(state.list && state.details);
  return { ...state, list: collapse, details: collapse };
}

/** True when the key event is the panel hotkey and focus is not in a text field, slider or editable element. */
export function isPanelHotkey(event) {
  if (!event || event.defaultPrevented || event.repeat) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key !== 'h' && event.key !== 'H') return false;
  const target = event.target;
  const tag = target?.tagName ? String(target.tagName).toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
  if (target?.isContentEditable) return false;
  if (target?.getAttribute?.('role') === 'slider') return false;
  return true;
}

/**
 * Mobile framing: the vertical shift (CSS px) of the camera's principal point
 * that puts the summit (screen centre) in the middle of the visible band
 * between `top` (under the header / summit row) and `bottom` (top edge of the
 * bottom sheet). Positive = the scene moves up. Used with
 * camera.setViewOffset(width, height, 0, offset, width, height).
 */
export function viewOffsetY({ height, top = 0, bottom = height }) {
  if (!(height > 0)) return 0;
  const t = Math.max(0, Math.min(height, top));
  const b = Math.max(t, Math.min(height, bottom));
  return Math.round(height / 2 - (t + b) / 2);
}
