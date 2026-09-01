export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatRelativeDate(iso: string): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = target - now;
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  if (absMs < hour) {
    return rtf.format(Math.round(diffMs / minute), "minute");
  }
  if (absMs < day) {
    return rtf.format(Math.round(diffMs / hour), "hour");
  }
  return rtf.format(Math.round(diffMs / day), "day");
}

export function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

// Half-up rounding to N decimals — JS `toFixed` uses banker-style rounding on
// some floats (e.g. (1.2345).toFixed(3) === "1.234"), which violates the
// formatting contract pinned in spec §FR-5.
function roundHalfUp(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(value) * factor) / factor;
  const signed = value < 0 ? -rounded : rounded;
  return signed.toFixed(decimals);
}

export function formatCO2eKg(value: number): string {
  return `${roundHalfUp(value, 3)} kg CO₂`;
}

export function formatPer100g(value: number): string {
  return `${roundHalfUp(value, 3)} kg CO₂ / 100g`;
}
