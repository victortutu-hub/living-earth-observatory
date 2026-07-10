const REASON_PRIORITY = Object.freeze({
  activate: 120,
  hover: 100,
  focus: 95,
  'canvas-focus': 90,
  'section-proximity': 70,
  'primary-idle': 40,
  'fallback-idle': 10,
  intent: 80,
  'network-online': 85,
  'manual-reload': 118,
  'offline-test': 116,
  'runtime-recovery': 112,
});

export function createPrefetchBudget({ maxConcurrent = 1, maxQueued = 8, atlasStatus = null } = {}) {
  let sequence = 0;
  const queue = [];
  const running = new Map();
  const scheduled = new Map();

  function publish() {
    const value = `${running.size} ACTIVE · ${queue.length} QUEUED`;
    atlasStatus?.setStatus('prefetch', value, running.size || queue.length ? 'live' : 'ready', {
      phase: running.size ? 'loading' : queue.length ? 'queued' : 'idle',
      updated: new Date().toISOString(),
    });
    document.dispatchEvent(new CustomEvent('lumi:prefetch-budget', {
      detail: { active: running.size, queued: queue.length, maxConcurrent, maxQueued },
    }));
  }

  function sortQueue() {
    queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
  }

  function pump() {
    while (running.size < maxConcurrent && queue.length) {
      const entry = queue.shift();
      if (entry.cancelled) continue;
      running.set(entry.key, entry);
      entry.started = true;
      publish();
      Promise.resolve(entry.task())
        .then(entry.resolve, entry.reject)
        .finally(() => {
          running.delete(entry.key);
          if (scheduled.get(entry.key) === entry) scheduled.delete(entry.key);
          publish();
          pump();
        });
    }
    publish();
  }

  function preemptIfNeeded(incoming) {
    if (running.size < maxConcurrent) return;
    const lowest = [...running.values()].sort((a, b) => a.priority - b.priority)[0];
    if (!lowest || incoming.priority < lowest.priority + 35) return;
    lowest.cancel?.(`prefetch-preempted-by-${incoming.reason}`);
  }

  function schedule({ key, reason = 'intent', task, cancel = null, priority = null, replace = false }) {
    if (scheduled.has(key) && !replace) return scheduled.get(key).promise;
    if (scheduled.has(key) && replace) cancelEntry(key, `replaced-by-${reason}`);
    const entry = {
      key,
      reason,
      task,
      cancel,
      priority: Number.isFinite(priority) ? priority : (REASON_PRIORITY[reason] ?? 50),
      sequence: sequence++,
      started: false,
      cancelled: false,
    };
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    scheduled.set(key, entry);
    preemptIfNeeded(entry);
    if (queue.length >= maxQueued) {
      sortQueue();
      const dropped = queue.pop();
      if (dropped) {
        dropped.cancelled = true;
        scheduled.delete(dropped.key);
        dropped.resolve(false);
      }
    }
    queue.push(entry);
    sortQueue();
    publish();
    pump();
    return entry.promise;
  }

  function cancelEntry(key, reason = 'budget-cancelled') {
    const entry = scheduled.get(key);
    if (!entry) return false;
    entry.cancelled = true;
    if (entry.started) {
      entry.cancel?.(reason);
      scheduled.delete(key);
    } else {
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
      entry.resolve(false);
      scheduled.delete(key);
    }
    publish();
    return true;
  }

  function cancel(key, reason = 'budget-cancelled') {
    return cancelEntry(key, reason);
  }

  function dispose() {
    [...scheduled.keys()].forEach((key) => cancelEntry(key, 'budget-disposed'));
  }

  publish();
  return Object.freeze({ schedule, cancel, dispose, get active() { return running.size; }, get queued() { return queue.length; } });
}
