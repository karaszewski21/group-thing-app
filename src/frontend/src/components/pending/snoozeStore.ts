import dayjs from "../../utils/dayjs";

/** Snooze expiry (epoch ms) per pending-action key (`n:{notificationId}`). */
export type SnoozeMap = Record<string, number>;

/** Used when localStorage throws or holds nothing, so a snooze still lasts
 * for the page's lifetime in private windows or with blocked storage. */
const memoryFallback = new Map<string, SnoozeMap>();

/** Today at 08:00 browser-local time if `now` is before it, otherwise tomorrow at 08:00. */
export function nextLocal0800(now: Date): Date {
  const today0800 = dayjs(now).hour(8).minute(0).second(0).millisecond(0);
  return (dayjs(now).isBefore(today0800) ? today0800 : today0800.add(1, "day")).toDate();
}

/** Per-account key, following the panel's `hintKey` pattern. */
function storageKey(username: string | null): string {
  return `pendingActionSnooze:${username ?? ""}`;
}

/** Keeps only finite-number expiries; `null` for anything that is not a plain object. */
function toSnoozeMap(value: unknown): SnoozeMap | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
  );
}

function readStored(key: string): SnoozeMap {
  try {
    const stored = localStorage.getItem(key);
    const parsed = stored === null ? null : toSnoozeMap(JSON.parse(stored));
    if (parsed !== null) return parsed;
  } catch {
    // Storage blocked or corrupt: fall through to the in-memory copy.
  }
  return memoryFallback.get(key) ?? {};
}

function write(key: string, map: SnoozeMap) {
  memoryFallback.set(key, map);
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // The in-memory copy above keeps the snooze for this page's lifetime.
  }
}

/** The account's snoozes that are still active at `now`; expired entries are pruned. */
export function getSnoozed(username: string | null, now: Date = new Date()): SnoozeMap {
  const key = storageKey(username);
  const stored = readStored(key);
  const active = Object.fromEntries(Object.entries(stored).filter(([, until]) => until > now.getTime()));
  if (Object.keys(active).length !== Object.keys(stored).length) write(key, active);
  return active;
}

/** Hides `actionKey` until the next local 08:00 and returns the updated active snoozes. */
export function snooze(username: string | null, actionKey: string, now: Date = new Date()): SnoozeMap {
  const next = { ...getSnoozed(username, now), [actionKey]: nextLocal0800(now).getTime() };
  write(storageKey(username), next);
  return next;
}

export function earliestExpiry(map: SnoozeMap): number | null {
  const expiries = Object.values(map);
  return expiries.length > 0 ? Math.min(...expiries) : null;
}

export function resetSnoozeStoreForTests() {
  memoryFallback.clear();
}
