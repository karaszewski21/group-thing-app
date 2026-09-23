import type { ReactNode } from "react";
import { SharesIcon, BringsIcon } from "./Icons";

/** Deterministic avatar background palette — ported 1:1 from
 * `TermPage.tsx`'s former module-level `PALETTE` (unchanged values, so
 * the CIRCLE layout renders pixel-identical after the refactor). */
const PALETTE = ["#1B8168", "#5D8A63", "#3F8E90", "#7E9A34", "#2A6B58", "#4E7D55", "#35797B", "#6B8A2F"];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

/** Deterministic avatar background color for a family name — ported 1:1
 * from `TermPage.tsx`'s former `familyColor` (same `PALETTE`/hash). */
export function familyColor(name: string): string {
  return PALETTE[hashString(name) % PALETTE.length];
}

/** Up-to-2-letter initials for a family name — ported 1:1 from
 * `TermPage.tsx`'s former `familyInitials`. */
export function familyInitials(name: string): string {
  const words = name.replace(/^Rodzina\s+/i, "").split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? "?").toUpperCase() + (words[1]?.[0] ?? words[0]?.[1] ?? "").toUpperCase();
}

export interface AvatarProps {
  /** Family (or person) display name — the avatar's background color and initials are both derived from it. */
  name: string;
  /** Circle styling hook; defaults to the legacy `.kg-av` look shared by the group visualization's circle avatars. */
  className?: string;
  /** Renders a green "udostępnia" (shares) marker in the bottom-right corner. */
  showsSharesIcon?: boolean;
  /** Renders a teal "przynosi" (brings) marker in the bottom-left corner. */
  showsBringsIcon?: boolean;
}

/**
 * Single, reusable rendering of a family avatar: a colored circle with
 * initials, plus optional "udostępnia"/"przynosi" corner markers.
 *
 * Consolidates the `PALETTE`/`hashString`/initials logic that used to be
 * duplicated across `TermPage.tsx` (the circle avatar, the family
 * card avatar, and the needed-item row avatar). Avatar is purely
 * presentational: whether a given family actually "shares" or "brings"
 * something is decided by the caller via `showsSharesIcon`/`showsBringsIcon`,
 * never by Avatar itself.
 */
export function Avatar({
  name,
  className = "kg-av",
  showsSharesIcon = false,
  showsBringsIcon = false,
}: AvatarProps): ReactNode {
  return (
    <span className={className} style={{ background: familyColor(name) }}>
      {familyInitials(name)}
      {showsSharesIcon && (
        <span className="kg-mark kg-mark-shares" aria-label="Udostępnia rzecz">
          <SharesIcon size={11} strokeWidth={2.5} />
        </span>
      )}
      {showsBringsIcon && (
        <span className="kg-mark-left kg-mark-brings" aria-label="Przynosi na zajęcia">
          <BringsIcon size={11} strokeWidth={2.5} />
        </span>
      )}
    </span>
  );
}
