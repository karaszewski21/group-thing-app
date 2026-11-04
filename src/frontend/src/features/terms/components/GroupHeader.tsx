import type { ReactNode } from "react";
import { OrganizerHeaderBar } from "../../../components/shared/OrganizerHeaderBar";

/** Term and event page header: a chip to the organizer's page, an optional
 * eyebrow, the name and an optional subtitle line (omitted entirely when
 * `subtitle` is null). */
export function GroupHeader({
  title,
  subtitle = null,
  eyebrow,
  organizerName = null,
  organizerSlug = null,
}: {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: string;
  organizerName?: string | null;
  /** The organizer page's path segment: an Organization slug or, for an
   * organizer without one, their party id (the person profile). */
  organizerSlug?: string | null;
}) {
  return (
    <header className="px-5 pt-3 pb-4">
      <OrganizerHeaderBar organizerName={organizerName} organizerSlug={organizerSlug} />
      <div className={organizerSlug ? "mt-3.5" : undefined}>
        {eyebrow && <p className="text-xs font-extrabold tracking-[.14em] text-accent-fg uppercase">{eyebrow}</p>}
        <h1 className="font-serif text-[34px] leading-tight font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle != null && <p className="mt-1 text-base text-ink-soft">{subtitle}</p>}
      </div>
    </header>
  );
}
