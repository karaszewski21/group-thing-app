/** The two-option segmented controls of `/search` (mode tabs, scope). */
export const SEGMENT_CLASS =
  "rounded-full font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
export const segmentTone = (on: boolean) =>
  on ? "bg-paper text-ink shadow-[0_2px_8px_-2px_rgba(42,35,32,0.25)]" : "text-ink-soft hover:text-ink";
