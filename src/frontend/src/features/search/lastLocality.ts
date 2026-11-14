import type { Locality } from "../../api/locations";

const STORAGE_KEY = "search.lastLocality";
const FIELDS = ["id", "name", "kind", "gmina", "powiat", "voivodeship"] as const;

/** The locality last picked in the search filter on this device; `null`
 * on the server, without one, and when storage is blocked or holds junk. */
export function readLastLocality(): Locality | null {
  if (typeof window === "undefined") return null;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof stored !== "object" || stored === null) return null;
    const record = stored as Record<string, unknown>;
    if (!FIELDS.every((field) => typeof record[field] === "string")) return null;
    return /^\d{7}$/.test(record.id as string) ? (stored as Locality) : null;
  } catch {
    return null;
  }
}

export function saveLastLocality({ id, name, kind, gmina, powiat, voivodeship }: Locality): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, name, kind, gmina, powiat, voivodeship }));
  } catch {
    // Storage is blocked: the pick still applies, it is just not remembered.
  }
}
