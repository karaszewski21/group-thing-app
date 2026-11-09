import type { EventParticipant, EventParticipantItem } from "../../api/events";
import type { ParticipantPreviewItem } from "../../components/shared/ParticipantItemsPreview";
import type { ParticipantRow } from "../../components/shared/ParticipantList";

function toPreviewItem(item: EventParticipantItem): ParticipantPreviewItem {
  return {
    itemId: item.item_id,
    name: item.product_name,
    modes: [item.mode],
    thumbUrl: item.thumb_url,
    addedAt: item.added_at,
    reservation: item.reservation,
  };
}

/** The author (always first, "Organizator") and the attendees; the viewer's
 * own row says "To Ty". */
export function buildEventParticipants(participants: EventParticipant[]): ParticipantRow[] {
  return participants.map((p) => ({
    partyId: p.party_id,
    name: p.display_name,
    items: p.items.map(toPreviewItem),
    itemsTotal: p.items_total,
    badge: p.is_author ? "author" : p.is_me ? "me" : undefined,
  }));
}

/** `null` once anyone besides the author signed up; the sign-up nudge only
 * for a viewer who can. */
export function eventAttendeesEmptyCopy(participants: EventParticipant[], canSignUp: boolean): string | null {
  if (!participants.every((p) => p.is_author)) return null;
  return canSignUp
    ? "Nikt jeszcze się nie zapisał. Zapisz się jako pierwsza osoba i pokaż, co przyniesiesz do wymiany."
    : "Nikt jeszcze się nie zapisał.";
}
