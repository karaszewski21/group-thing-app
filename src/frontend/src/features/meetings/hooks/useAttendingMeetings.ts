import type { EventResponse } from "../../../api/events";
import type { MyPledgeResponse } from "../../../api/pledges";
import type { NeededItemResponse } from "../../../api/terms";
import { useAttendingEvents } from "../../../hooks/useAttendingEvents";
import { useMyPledges } from "../../../hooks/useMyPledges";
import { useMyTerms, type UseMyTermsResult } from "../../../hooks/useMyTerms";
import { useNeededItems } from "../../../hooks/useNeededItems";
import type { GuestTermCard } from "../../../utils/appHelpers";
import { useAppData } from "../../panel/appDataStore";
import { memberTermCard, mergeLatestFirst } from "../meetingsList";

const NO_PLEDGES: MyPledgeResponse[] = [];

export interface AttendingMeetings {
  /** Attended events, RSVPed terms and private circles' terms, latest date first. */
  entries: (GuestTermCard | EventResponse)[];
  paged: UseMyTermsResult;
  neededItems: ReadonlyMap<string, NeededItemResponse[]>;
  /** The caller's not-withdrawn pledges of a term. */
  pledgesOf: (termId: string) => MyPledgeResponse[];
  /** Withdraws a pledge and reports the outcome in a toast. */
  withdrawPledge: (pledgeId: string) => Promise<void>;
  /** Until the first member terms page, the attended events and the pledges are in. */
  loading: boolean;
  error: string | null;
}

/** "Biorę udział" from three sources: the events the caller signed up for,
 * the terms they RSVPed to (from the panel) and, page by page, the terms of
 * the private circles they or their family belong to. Plus those terms' needs
 * and the caller's pledges, each shown on its term's card (pledging needs an
 * RSVP or a membership). */
export function useAttendingMeetings(): AttendingMeetings {
  const { savedCards, showToast, load } = useAppData();
  const member = useMyTerms("member");
  const events = useAttendingEvents();
  const pledges = useMyPledges();

  const savedIds = new Set(savedCards.map((card) => card.termId));
  const memberCards = member.terms.filter((term) => !savedIds.has(term.id)).map(memberTermCard);

  const pledgesByTerm = new Map<string, MyPledgeResponse[]>();
  for (const pledge of pledges.data) {
    if (pledge.status === "WITHDRAWN") continue;
    pledgesByTerm.set(pledge.term_id, [...(pledgesByTerm.get(pledge.term_id) ?? []), pledge]);
  }
  const { data: neededItems, refetch: refetchNeededItems } = useNeededItems([
    ...savedIds,
    ...memberCards.map((card) => card.termId),
  ]);

  async function withdrawPledge(pledgeId: string) {
    try {
      await pledges.withdraw(pledgeId);
    } catch {
      showToast("Nie udało się wycofać zgłoszenia");
      return;
    }
    showToast("Wycofano zgłoszenie");
    // The pledge's needed item may sit on one of the caller's own terms.
    void load({ silent: true });
    void refetchNeededItems();
  }

  return {
    entries: mergeLatestFirst<GuestTermCard | EventResponse>(member, memberCards, [...savedCards, ...events.data]),
    paged: member,
    neededItems,
    pledgesOf: (termId) => pledgesByTerm.get(termId) ?? NO_PLEDGES,
    withdrawPledge,
    loading: member.loading || events.loading || pledges.loading,
    error: member.error ?? events.error ?? pledges.error,
  };
}
