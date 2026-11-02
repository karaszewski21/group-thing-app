const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/** The index arrow-key roving focus moves to, wrapping at both ends; `null`
 * when the key does not move it. A horizontal widget (a tablist) ignores the
 * up and down arrows. */
export function nextIndex(
  key: string,
  index: number,
  length: number,
  orientation: "horizontal" | "both" = "both",
): number | null {
  if (orientation === "horizontal" && (key === "ArrowUp" || key === "ArrowDown")) return null;
  const step = NEXT_KEYS.has(key) ? 1 : PREVIOUS_KEYS.has(key) ? -1 : 0;
  if (step === 0) return null;
  return (index + step + length) % length;
}
