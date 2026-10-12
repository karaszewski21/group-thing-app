import type { ReactNode } from "react";
import { SharesIcon, BringsIcon } from "./Icons";

/** Avatar backgrounds: light and lighter tints of the organizer's two
 * palette colors, so the circle follows the organizer theme; ink initials
 * keep 4.5:1 on every tint. */
const TONES = [
  "bg-[color-mix(in_oklab,var(--color-primary)_55%,white)]",
  "bg-[color-mix(in_oklab,var(--color-accent)_75%,white)]",
  "bg-[color-mix(in_oklab,var(--color-primary)_30%,white)]",
  "bg-[color-mix(in_oklab,var(--color-accent)_45%,white)]",
];

const SIZES = {
  lg: "h-13 w-13 border-[3px] text-[15px]",
  md: "h-10 w-10 border-2 text-[12.5px]",
};

const MARKER =
  "absolute -bottom-1.25 flex h-5 w-5 items-center justify-center rounded-full border-[2.5px] border-paper text-ink";

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

/** Deterministic background tone class for a family name. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the hero's initials and tests
export function familyTone(name: string): string {
  return TONES[hashString(name) % TONES.length];
}

/** Up-to-2-letter initials for a family name, without a leading "Rodzina". */
// eslint-disable-next-line react-refresh/only-export-components -- also used by the organizer hero
export function familyInitials(name: string): string {
  const words = name.replace(/^Rodzina\s+/i, "").split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? "?").toUpperCase() + (words[1]?.[0] ?? words[0]?.[1] ?? "").toUpperCase();
}

export interface AvatarProps {
  /** Family (or person) display name — the avatar's tone and initials are both derived from it. */
  name: string;
  /** `lg` in the group visualization, `md` in lists. */
  size?: keyof typeof SIZES;
  /** Renders the "udostępnia" (shares) marker in the bottom-right corner. */
  showsSharesIcon?: boolean;
  /** Renders the "przynosi" (brings) marker in the bottom-left corner. */
  showsBringsIcon?: boolean;
}

/**
 * A family avatar: a tinted circle with initials, plus optional
 * "udostępnia"/"przynosi" corner markers. Whether a family shares or brings
 * something is decided by the caller, never by Avatar itself.
 */
export function Avatar({
  name,
  size = "lg",
  showsSharesIcon = false,
  showsBringsIcon = false,
}: AvatarProps): ReactNode {
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center rounded-full border-paper font-extrabold text-ink shadow-[0_8px_18px_-10px_rgba(30,46,39,.7)] ${SIZES[size]} ${familyTone(name)}`}
    >
      {familyInitials(name)}
      {showsSharesIcon && (
        <span className={`${MARKER} -right-1.25 bg-accent`} aria-label="Udostępnia rzecz">
          <SharesIcon size={11} strokeWidth={2.5} />
        </span>
      )}
      {showsBringsIcon && (
        <span className={`${MARKER} -left-1.25 bg-teal`} aria-label="Przynosi na zajęcia">
          <BringsIcon size={11} strokeWidth={2.5} />
        </span>
      )}
    </span>
  );
}
