// The label and range mirror `app/settings/service.py`, so the inline
// message is the one the server would send.
const MAX_FEATURED_ITEMS_LABEL = "Limit wyróżnionych rzeczy";
export const MAX_FEATURED_ITEMS_MAX = 20;

/** The limit typed in the form, or a Polish error for anything but a whole number 0–20. */
export function parseMaxFeaturedItems(raw: string): { value: number; error: null } | { value: null; error: string } {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: `${MAX_FEATURED_ITEMS_LABEL} musi być liczbą całkowitą ≥ 0.` };
  }
  const value = Number(trimmed);
  if (value > MAX_FEATURED_ITEMS_MAX) {
    return { value: null, error: `${MAX_FEATURED_ITEMS_LABEL} musi być liczbą całkowitą ≤ ${MAX_FEATURED_ITEMS_MAX}.` };
  }
  return { value, error: null };
}
