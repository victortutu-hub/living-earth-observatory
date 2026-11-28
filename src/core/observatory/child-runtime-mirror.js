// LOT 23 (extracted from the LOT 21 Himalaya adapter): mirror a same-origin child page's runtime
// state into the host page while the child is mounted in the Atlas. The child's runtime store
// dispatches lumi:observatory-runtime on its own document; each record is copied through the host
// module context (context.setRuntime), so the card badge and the control center show it.
// - A missing contentDocument (test frames) is tolerated: only the initial copy runs.
// - "cancelled" records are skipped: the host context writes its own unmount state.
// - The returned function removes the listener and the pending initial copy; the adapters call it
//   before destroying the child, so no copy follows an unmount.

/**
 * @param {object} p
 * @param {{contentDocument?: EventTarget|null}} p.frame the child iframe
 * @param {{snapshot?: (id: string) => ({runtime?: object}|null)}} p.childHost the child's module host
 * @param {string} p.id observatory id (records of other ids are ignored)
 * @param {{setRuntime?: Function}} p.context the host module context
 * @param {{setTimeout: Function, clearTimeout: Function}} [p.win]
 * @returns {() => void} stop
 */
export function mirrorChildRuntime({ frame, childHost, id, context, win = window }) {
  const childDocument = frame?.contentDocument || null;
  const copyRuntime = (record) => {
    if (!record?.state || record.phase === 'cancelled') return;
    context.setRuntime?.(record.state, { phase: record.phase || 'ready', reason: record.reason ? `child: ${record.reason}` : 'child-runtime', error: record.error || null });
  };
  const onChildRuntime = (event) => { if (event.detail?.id === id) copyRuntime(event.detail); };
  childDocument?.addEventListener('lumi:observatory-runtime', onChildRuntime);
  // The host context writes its own "module-ready" right after the adapter's start resolves (LOT 50: still in the
  // loading phase, not LIVE); this first copy is the adapter's own publication.
  const initialCopy = win.setTimeout(() => copyRuntime(childHost?.snapshot?.(id)?.runtime), 0);
  return () => {
    win.clearTimeout(initialCopy);
    childDocument?.removeEventListener('lumi:observatory-runtime', onChildRuntime);
  };
}
