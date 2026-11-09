import type { ReactNode } from "react";
import { Avatar } from "./Avatar";
import { ParticipantItemsPreview, type ParticipantPreviewItem } from "./ParticipantItemsPreview";

const PILL = "ml-auto shrink-0 rounded-full px-2.25 py-0.75 text-[11px] font-extrabold";

export interface ParticipantRow {
  partyId: string;
  name: string;
  /** The newest shared items (at most the preview limit). */
  items: ParticipantPreviewItem[];
  /** Every item this participant shares. */
  itemsTotal: number;
  badge?: "author" | "me";
}

/** The participant list ("Zapisani na …"), one entry per participant with a preview of the
 * items they share, each linking to its product page. `rowId` makes entries
 * focusable scroll targets; `activePartyId` highlights one of them.
 * `emptyMessage` (when given) renders below the list. */
export function ParticipantList({
  label,
  rows,
  emptyMessage,
  activePartyId = null,
  rowId,
}: {
  label: string;
  rows: ParticipantRow[];
  emptyMessage?: ReactNode;
  activePartyId?: string | null;
  rowId?: (partyId: string) => string;
}) {
  return (
    <section className="mx-5 mt-6" aria-label={label}>
      <h2 className="font-serif text-[22px] font-bold text-ink">{label}</h2>
      <ul className="mt-3 divide-y divide-line rounded-3xl border border-line bg-paper px-3.5 empty:hidden">
        {rows.map((row) => {
          const active = row.partyId === activePartyId;
          return (
            <li
              key={row.partyId}
              id={rowId?.(row.partyId)}
              tabIndex={rowId ? -1 : undefined}
              data-active={active || undefined}
              className={`py-3 ${rowId ? "scroll-mt-30 transition-colors outline-none focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)]" : ""} ${active ? "-mx-1.5 rounded-2xl bg-primary-soft px-1.5" : ""}`}
            >
              <div className="flex items-center gap-3">
                <Avatar name={row.name} size="md" showsSharesIcon={row.items.length > 0} />
                <strong className="min-w-0 text-base wrap-break-word">{row.name}</strong>
                {row.badge === "author" && (
                  <span className={`${PILL} bg-accent-soft tracking-[.08em] text-accent-fg uppercase`}>Organizator</span>
                )}
                {row.badge === "me" && <span className={`${PILL} bg-primary-soft text-primary-fg`}>To Ty</span>}
              </div>
              <ParticipantItemsPreview items={row.items} total={row.itemsTotal} partyId={row.partyId} />
            </li>
          );
        })}
      </ul>
      {emptyMessage && (
        <p className="mt-3 rounded-[20px] border-2 border-dashed border-line-strong px-4 py-3.5 text-[15px] leading-snug text-ink-soft">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}
