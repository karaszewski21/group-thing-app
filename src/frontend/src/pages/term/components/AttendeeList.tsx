import type { ExchangeMode, PublicItemListingResponse } from "../../../api/groups";
import { Avatar } from "../../../components/shared/Avatar";
import { ParticipantItemsPreview, type ParticipantPreviewItem } from "../../../components/shared/ParticipantItemsPreview";
import type { ItemContext } from "../../product/useItemRoutes";
import { EXCHANGE_MODE_TONE, LISTABLE_RESERVATION_TYPES } from "./termLabels";
import { attendeeElementId, type ListingRowVM } from "./termSectionTypes";

/** An offered item: its take actions plus the listing the preview row shows. */
export type AttendeeListingVM = ListingRowVM & { listing: PublicItemListingResponse };

export interface AttendeeVM {
  partyId: string;
  name: string;
  /** The newest offered items on this Term (at most the preview limit). */
  listings: AttendeeListingVM[];
  /** Every item this person offers on this Term. */
  listingsTotal: number;
  organizerSlug: string | null;
  context: ItemContext | null;
}

/** A take action wears its exchange mode's tone (Zamień / Weź na stałe). */
function actionTone(key: string): string {
  return EXCHANGE_MODE_TONE[key as ExchangeMode] ?? EXCHANGE_MODE_TONE.GIFT;
}

function toPreviewItem(listing: PublicItemListingResponse): ParticipantPreviewItem {
  return {
    itemId: listing.item_id,
    name: listing.product_name,
    modes: LISTABLE_RESERVATION_TYPES.filter((mode) => listing.offered_types.includes(mode)),
    thumbUrl: listing.thumb_url,
    addedAt: listing.added_at,
  };
}

/** The take buttons under an offered item, then its extra content (the swap
 * picker or the account-merge mini-form). */
function ListingActions({ row }: { row: ListingRowVM }) {
  if (row.actions.length === 0 && !row.extra) return null;
  return (
    <>
      {row.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {row.actions.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`min-h-9 rounded-full px-3.5 text-[13px] font-extrabold whitespace-nowrap disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${actionTone(a.key)}`}
              disabled={a.disabled}
              aria-label={a.ariaLabel}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {row.extra}
    </>
  );
}

/** "Zapisani na zajęcia" — one entry per attendee with a preview of the
 * items they offer (and the take/swap buttons for each). `activePartyId` highlights the entry
 * picked from the visualization. */
export function AttendeeList({
  attendees,
  activePartyId,
}: {
  attendees: AttendeeVM[];
  activePartyId: string | null;
}) {
  return (
    <section className="mx-5 mt-6" aria-label="Zapisani na zajęcia">
      <h2 className="font-serif text-[22px] font-bold text-ink">Zapisani i ich rzeczy</h2>
      {attendees.length === 0 && (
        <p className="mt-3 rounded-[20px] border-2 border-dashed border-line-strong px-4 py-3.5 text-[15px] leading-snug text-ink-soft">Tu zobaczysz rodziny i rzeczy, które przyniosą do wymiany.</p>
      )}
      <ul className="mt-3 divide-y divide-line rounded-3xl border border-line bg-paper px-3.5 empty:hidden">
        {attendees.map((attendee) => {
          const active = attendee.partyId === activePartyId;
          return (
            <li
              key={attendee.partyId}
              id={attendeeElementId(attendee.partyId)}
              tabIndex={-1}
              data-active={active || undefined}
              className={`scroll-mt-30 py-3 transition-colors outline-none focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)] ${active ? "-mx-1.5 rounded-2xl bg-primary-soft px-1.5" : ""}`}
            >
              <div className="flex items-center gap-3">
                <Avatar name={attendee.name} size="md" showsSharesIcon={attendee.listings.length > 0} />
                <strong className="min-w-0 text-base wrap-break-word">{attendee.name}</strong>
              </div>
              <ParticipantItemsPreview
                items={attendee.listings.map((row) => toPreviewItem(row.listing))}
                total={attendee.listingsTotal}
                partyId={attendee.partyId}
                context={attendee.context}
                organizerSlug={attendee.organizerSlug}
                renderActions={(item) => {
                  const row = attendee.listings.find((r) => r.listing.item_id === item.itemId);
                  return row && <ListingActions row={row} />;
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
