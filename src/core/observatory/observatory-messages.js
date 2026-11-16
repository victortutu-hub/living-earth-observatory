// Message contract between a parent observatory frame and the Atlas.
// {type, id, focus} is required; `time` (Himalaya LOT 5) is optional: the
// scene time of the parent when it is not on Live, as an ISO UTC string.
export const OBSERVATORY_ENTER_MESSAGE = 'lumi:switch-observatory';
export const ENTER_MESSAGE_REQUIRED_KEYS = Object.freeze(['focus', 'id', 'type']);
export const ENTER_MESSAGE_OPTIONAL_KEYS = Object.freeze(['time']);

// Living Earth's timeline reaches 365 days back; one day of slack.
export const TIME_MAX_PAST_DAYS = 366;
export const TIME_MAX_FUTURE_MS = 5 * 60_000;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/**
 * The single validator for an observatory scene time: an ISO UTC string
 * ending in "Z" (YYYY-MM-DDTHH:MM[:SS[.sss]]Z) that is a real date, between
 * now - 366 days and now + 5 min. Returns the canonical toISOString() form,
 * or null (anything else: other offsets, date only, numbers, null).
 */
export function validateObservatoryTime(value, now = new Date()) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  // Reject calendar overflow (e.g. 2026-02-30) that Date.parse would roll over.
  if (new Date(ms).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const nowMs = now.getTime();
  if (ms < nowMs - TIME_MAX_PAST_DAYS * 86400000 || ms > nowMs + TIME_MAX_FUTURE_MS) return null;
  return new Date(ms).toISOString();
}
