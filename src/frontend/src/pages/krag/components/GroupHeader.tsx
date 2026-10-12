import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Term page header: back button, a chip back to the organizer's page, an
 * optional eyebrow, the group name and an optional subtitle line (omitted
 * entirely when `subtitle` is null). */
export function GroupHeader({
  title,
  subtitle = null,
  eyebrow,
  onBack,
  organizerName = null,
  organizerSlug = null,
}: {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: string;
  onBack: () => void;
  organizerName?: string | null;
  organizerSlug?: string | null;
}) {
  return (
    <header className="px-5 pt-3 pb-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Wróć"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </button>
        {organizerSlug && (
          <Link
            to={`/${organizerSlug}`}
            className="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-full border-[1.5px] border-line bg-paper py-1 pr-3.5 pl-1.5 text-[13px] font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-primary font-serif text-xs font-extrabold text-on-primary"
            >
              {(organizerName ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{organizerName ?? "Strona organizatora"}</span>
          </Link>
        )}
      </div>
      <div className="mt-3.5">
        {eyebrow && <p className="text-xs font-extrabold tracking-[.14em] text-accent-fg uppercase">{eyebrow}</p>}
        <h1 className="font-serif text-[34px] leading-tight font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle != null && <p className="mt-1 text-base text-ink-soft">{subtitle}</p>}
      </div>
    </header>
  );
}
