import type { CSSProperties } from "react";

/** A seat drawn while nobody has signed up yet — dashed, decorative only. */
export function GhostSeat({ style, onPitch = false }: { style: CSSProperties; onPitch?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-ghost-seat
      className={`absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed ${
        onPitch ? "border-white/75 bg-white/10" : "border-primary/45 bg-paper"
      }`}
      style={style}
    />
  );
}
