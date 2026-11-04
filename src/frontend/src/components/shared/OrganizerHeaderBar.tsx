import { Link } from "../../routing/navigation";

/** The chip at the top of the organizer's public pages (term, event, owner
 * items), linking to the organizer's page; nothing without `organizerSlug`. */
export function OrganizerHeaderBar({
  organizerName = null,
  organizerSlug = null,
}: {
  organizerName?: string | null;
  /** The organizer page's path segment: an Organization slug or, for an
   * organizer without one, their party id (the person profile). */
  organizerSlug?: string | null;
}) {
  if (!organizerSlug) return null;
  return (
    <div className="flex justify-end">
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
    </div>
  );
}
