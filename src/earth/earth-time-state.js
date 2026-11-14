// The single owner of the Earth scene date. Astronomy follows `date` on every
// change; data layers follow `dataDay` (the UTC calendar day of a historical
// date, null in Live) through subscribeDataDay(), which fires only when that
// day actually changes, after a short debounce.
import { utcDay } from './temporal-provenance.js';

function validDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('Historical time requires a valid date.');
    return date;
}

export const DATA_DAY_DEBOUNCE_MS = 400;

export function createEarthTimeState({ initialDate = null } = {}) {
    let mode = initialDate ? 'historical' : 'live';
    let historicalDate = initialDate ? validDate(initialDate) : null;
    const listeners = new Set();

    function now() {
        return mode === 'historical' ? new Date(historicalDate.getTime()) : new Date();
    }

    function dataDay() {
        return mode === 'historical' ? utcDay(historicalDate) : null;
    }

    function snapshot() {
        const date = now();
        return Object.freeze({
            mode,
            date,
            iso: date.toISOString(),
            historical: mode === 'historical',
            dataDay: dataDay(),
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

    /**
     * listener(dataDay) runs once per change of UTC day (null = Live), after
     * `debounceMs` without further changes. Moving within the same day, or
     * dragging through several days and back, runs nothing. The returned
     * function unsubscribes and cancels a pending call.
     */
    function subscribeDataDay(listener, { debounceMs = DATA_DAY_DEBOUNCE_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        if (typeof listener !== 'function') throw new TypeError('Data-day listener must be a function.');
        let delivered = dataDay();
        let timer = null;
        let active = true;
        const unsubscribe = subscribe(() => {
            if (timer !== null) clearTimer(timer);
            timer = setTimer(() => {
                timer = null;
                if (!active) return;
                const day = dataDay();
                if (day === delivered) return;
                delivered = day;
                listener(day);
            }, debounceMs);
        });
        return () => {
            active = false;
            if (timer !== null) clearTimer(timer);
            timer = null;
            unsubscribe();
        };
    }

    return Object.freeze({
        now,
        dataDay,
        snapshot,
        setHistoricalTime,
        useLiveTime,
        subscribe,
        subscribeDataDay,
    });
}
