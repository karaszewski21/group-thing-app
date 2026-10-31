import { useParams } from "react-router-dom";
import type { EventParticipant, EventParticipantItem } from "../../../api/events";
import { Avatar } from "../../../components/shared/Avatar";
import { ParticipantItemsPreview, type ParticipantPreviewItem } from "../../../components/shared/ParticipantItemsPreview";

const PILL = "ml-auto shrink-0 rounded-full px-2.25 py-0.75 text-[11px] font-extrabold";

function toPreviewItem(item: EventParticipantItem): ParticipantPreviewItem {
  return {
    itemId: item.item_id,
    name: item.product_name,
    modes: [item.mode],
    thumbUrl: item.thumb_url,
    addedAt: item.added_at,
  };
}

/** "Zapisani na wydarzenie": the author (always first, "Organizator") and the
 * attendees with the items they share; the viewer's own row says "To Ty".
 * Item links use the author's slug, the event page's URL prefix, and carry
 * `?event=` (the event id comes from the `:eventId` route param). The empty
 * copy nudges to sign up only a viewer who can. */
export function EventAttendeeList({
  participants,
  authorSlug,
  canSignUp,
}: {
  participants: EventParticipant[];
  authorSlug: string;
  canSignUp: boolean;
}) {
  const { eventId } = useParams();
  const context = eventId ? { kind: "event" as const, id: eventId } : null;
  const nobodySignedUp = participants.every((p) => p.is_author);

  return (
    <section className="mx-5 mt-6" aria-label="Zapisani na wydarzenie">
      <h2 className="font-serif text-[22px] font-bold text-ink">Zapisani i ich rzeczy</h2>
      <ul className="mt-3 divide-y divide-line rounded-3xl border border-line bg-paper px-3.5 empty:hidden">
        {participants.map((p) => (
          <li key={p.party_id} className="py-3">
            <div className="flex items-center gap-3">
              <Avatar name={p.display_name} size="md" showsSharesIcon={p.items.length > 0} />
              <strong className="min-w-0 text-base wrap-break-word">{p.display_name}</strong>
              {p.is_author ? (
                <span className={`${PILL} bg-accent-soft tracking-[.08em] text-accent-fg uppercase`}>Organizator</span>
              ) : (
                p.is_me && <span className={`${PILL} bg-primary-soft text-primary-fg`}>To Ty</span>
              )}
            </div>
            <ParticipantItemsPreview
              items={p.items.map(toPreviewItem)}
              total={p.items_total}
              partyId={p.party_id}
              context={context}
              organizerSlug={authorSlug}
            />
          </li>
        ))}
      </ul>
      {nobodySignedUp && (
        <p className="mt-3 rounded-[20px] border-2 border-dashed border-line-strong px-4 py-3.5 text-[15px] leading-snug text-ink-soft">
          Nikt jeszcze się nie zapisał.
          {canSignUp && " Zapisz się jako pierwsza osoba i pokaż, co przyniesiesz do wymiany."}
        </p>
      )}
    </section>
  );
}
