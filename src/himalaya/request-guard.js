// Living Himalaya: ONE retry policy for every request of the page (Terrarium
// tiles, GLO-30 patches, summit weather, Sentinel-2 STAC / COG / SCL).
//   * The shared request runtime is called with retries: 0; this guard owns the
//     retries: exponential backoff 2 s, 4 s (abortable), and at most
//     MAX_FAILED_ATTEMPTS failed network attempts per resource (runtime key)
//     per page visit. Aborted requests (summit changed, page left) are
//     cancellations, not failures, and are not counted.
//   * When a resource has used its attempts, the guard throws
//     RetryBudgetExhaustedError without touching the network; callers show a
//     final, honest state ("temporarily unavailable", "40 m kept") and no
//     timer asks again.
export const MAX_FAILED_ATTEMPTS = 3;
export const BACKOFF_MS = Object.freeze([2000, 4000, 8000]);

export class RetryBudgetExhaustedError extends Error {
  constructor(key, failures) {
    super(`No further automatic attempts for ${key} (${failures} failed attempts in this visit)`);
    this.name = 'RetryBudgetExhaustedError';
    this.key = key;
    this.failures = failures;
  }
}

export function createAttemptLedger(max = MAX_FAILED_ATTEMPTS) {
  const failures = new Map();
  return Object.freeze({
    max,
    failures: (key) => failures.get(key) || 0,
    remaining: (key) => Math.max(0, max - (failures.get(key) || 0)),
    fail: (key) => failures.set(key, (failures.get(key) || 0) + 1),
    snapshot: () => Object.fromEntries(failures),
  });
}

const isAbort = (error, signal) => signal?.aborted || error?.name === 'AbortError';

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Wraps a request runtime (createRequestRuntime) with the page-wide retry policy. */
export function createGuardedRuntime({ runtime, ledger, backoff = BACKOFF_MS, sleep = wait }) {
  async function fetchResource(options) {
    const { key, signal } = options;
    let attempt = 0;
    for (;;) {
      if (ledger.remaining(key) === 0) throw new RetryBudgetExhaustedError(key, ledger.failures(key));
      try {
        return await runtime.fetchResource({ ...options, retries: 0 });
      } catch (error) {
        if (isAbort(error, signal)) throw error;
        ledger.fail(key);
        const status = error?.cause?.status ?? error?.status;
        const retryable = !status || status === 408 || status === 425 || status === 429 || status >= 500;
        if (!retryable || ledger.remaining(key) === 0) throw error;
        await sleep(backoff[Math.min(attempt, backoff.length - 1)], signal);
        attempt += 1;
      }
    }
  }
  return Object.freeze({ ...runtime, fetchResource, ledger });
}
