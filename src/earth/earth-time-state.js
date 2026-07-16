function validDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('Historical time requires a valid date.');
    return date;
}

export function createEarthTimeState({ initialDate = null } = {}) {
    let mode = initialDate ? 'historical' : 'live';
    let historicalDate = initialDate ? validDate(initialDate) : null;
    const listeners = new Set();

    function now() {
        return mode === 'historical' ? new Date(historicalDate.getTime()) : new Date();
    }

    function snapshot() {
        const date = now();
        return Object.freeze({
            mode,
            date,
            iso: date.toISOString(),
            historical: mode === 'historical',
        });
    }

    function notify() {
        const next = snapshot();
        listeners.forEach((listener) => listener(next));
        if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('lumi:earth-time-state', { detail: next }));
        }
        return next;
    }

    function setHistoricalTime(value) {
        historicalDate = validDate(value);
        mode = 'historical';
        return notify();
    }

    function useLiveTime() {
        mode = 'live';
        historicalDate = null;
        return notify();
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('Time-state listener must be a function.');
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    return Object.freeze({
        now,
        snapshot,
        setHistoricalTime,
        useLiveTime,
        subscribe,
    });
}

