const ENTRY_KEY = 'lumi.portal.entry.v1';
const RETURN_KEY = 'lumi.portal.return.v1';
const RETURN_HISTORY_KEY = '__lumiAtlasPortalReturn';
const RETURN_QUERY_KEY = 'portalReturn';
const RETURN_WINDOW_MS = 8_000;

function readRecord(key) {
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch (_) {
    return null;
  }
}

function writeRecord(key, record) {
  try {
    sessionStorage.setItem(key, JSON.stringify(record));
  } catch (_) {
    // Continuity remains optional when storage is restricted.
  }
}

function removeRecord(key) {
  try {
    sessionStorage.removeItem(key);
  } catch (_) {
    // Continuity remains optional when storage is restricted.
  }
}

export function markPortalEntry(observatoryId) {
  writeRecord(ENTRY_KEY, { observatoryId, createdAt: Date.now() });
  try {
    const returnUrl = new URL(location.href);
    returnUrl.searchParams.set(RETURN_QUERY_KEY, 'atlas');
    history.replaceState(
      { ...(history.state || {}), [RETURN_HISTORY_KEY]: true },
      '',
      returnUrl.href,
    );
  } catch (_) {
    // Session storage remains available when history state cannot be changed.
  }
}

export function consumeAtlasReturn() {
  let historyArmed = false;
  try {
    const currentUrl = new URL(location.href);
    const queryArmed = currentUrl.searchParams.get(RETURN_QUERY_KEY) === 'atlas';
    historyArmed = Boolean(history.state?.[RETURN_HISTORY_KEY]) || queryArmed;
    if (historyArmed) {
      const nextState = { ...(history.state || {}) };
      delete nextState[RETURN_HISTORY_KEY];
      currentUrl.searchParams.delete(RETURN_QUERY_KEY);
      history.replaceState(nextState, '', currentUrl.href);
    }
  } catch (_) {
    historyArmed = false;
  }
  const record = readRecord(RETURN_KEY);
  removeRecord(RETURN_KEY);
  return historyArmed || Boolean(record?.expiresAt && record.expiresAt >= Date.now());
}

export function prepareObservatoryEntry({ observatoryId, title }) {
  const record = readRecord(ENTRY_KEY);
  const routeFromAtlas = new URLSearchParams(window.location.search).get('portal') === 'atlas';
  const fromAtlas = record?.observatoryId === observatoryId || routeFromAtlas;
  if (!fromAtlas) return { fromAtlas: false };
  removeRecord(ENTRY_KEY);

  const overlay = document.getElementById('appFadeOverlay');
  const kicker = overlay?.querySelector('.app-fade-kicker');
  const mark = overlay?.querySelector('.app-fade-mark');
  document.body.classList.add('portal-entry');
  if (kicker) kicker.textContent = 'Orbital Atlas / Portal Link';
  if (mark) mark.textContent = title;

  window.addEventListener('pagehide', () => {
    writeRecord(RETURN_KEY, { expiresAt: Date.now() + RETURN_WINDOW_MS });
  }, { once: true });

  return { fromAtlas: true };
}
