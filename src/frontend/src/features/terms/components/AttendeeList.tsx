import type { PublicItemListingResponse } from "../../../api/groups";
import { Avatar } from "../../../components/shared/Avatar";
import { ParticipantItemsPreview, type ParticipantPreviewItem } from "../../../components/shared/ParticipantItemsPreview";
import { LISTABLE_RESERVATION_TYPES } from "./termLabels";
import { attendeeElementId } from "./termSectionTypes";

export interface AttendeeVM {
  partyId: string;
  name: string;
  /** The newest offered items on this Term (at most the preview limit). */
  listings: PublicItemListingResponse[];
  /** Every item this person offers on this Term. */
  listingsTotal: number;
}

function toPreviewItem(listing: PublicItemListingResponse): ParticipantPreviewItem {
  return {
    itemId: listing.item_id,
    name: listing.product_name,
    modes: LISTABLE_RESERVATION_TYPES.filter((mode) => listing.offered_types.includes(mode)),
    thumbUrl: listing.thumb_url,
    addedAt: listing.added_at,
    reservation: listing.reservation,
  };
}

/** "Zapisani na zajęcia" — one entry per attendee with a preview of the
 * items they offer, each linking to its product page. `activePartyId`
 * highlights the entry picked from the visualization. */
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
                items={attendee.listings.map(toPreviewItem)}
                total={attendee.listingsTotal}
                partyId={attendee.partyId}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
