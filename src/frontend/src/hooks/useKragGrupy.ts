import { useCallback, useEffect, useState } from "react";
import { getFamiliesForGuardianParty, getGuardians, type GuardianResponse } from "../api/families";
import {
  getCurrentLeadership,
  getGroup,
  getMembershipsForCircle,
  getMyAttendances,
  withdrawMyAttendance as withdrawMyAttendanceApi,
  type GroupResponse,
  type MyAttendanceResponse,
} from "../api/groups";
import {
  createPledge,
  fulfillPledge,
  getPledges,
  syncPledgeFulfillment,
  withdrawPledge,
  type FulfillPledgeRequest,
  type PledgeResponse,
} from "../api/pledges";
import { getInventories, getInventoryItemBalance, getInventoryItems } from "../api/inventories";
import { getMyItemListingPreferences } from "../api/itemListingPreferences";
import { getMyProfile, getProfileByParty, type UserProfileResponse } from "../api/people";
import { getProducts } from "../api/products";
import { confirmTransaction, fulfillReservation, type ReservationType } from "../api/reservations";
import {
  getBrowseTermItemListings,
  getMyTermItemListings,
  proposeSwap as proposeSwapApi,
  takeTermItemListing,
  type BrowseTermItemListingResponse,
  type TakeTermItemListingRequest,
} from "../api/termItemListings";
import { getNeededItems, getTerms, type NeededItemResponse, type TermResponse } from "../api/terms";

export interface AvailableItem {
  id: number;
  productName: string;
}

export interface KragFamily {
  familyId: number;
  name: string;
  guardians: GuardianResponse[];
}

export interface KragNeededItemWithPledges {
  item: NeededItemResponse;
  pledges: PledgeResponse[];
}

export interface UseKragGrupyResult {
  loading: boolean;
  error: string | null;
  group: GroupResponse | null;
  organizer: UserProfileResponse | null;
  families: KragFamily[];
  myPartyId: number | null;
  currentTerm: TermResponse | null;
  neededItems: KragNeededItemWithPledges[];
  myAvailableItems: AvailableItem[];
  /** Subset of `myAvailableItems` whose `ItemListingPreference.mode` is
   * `"SWAP"` ("zamienię") — the only items eligible as a counter-offer in
   * `SwapProposeDialog`. Kept separate from `myAvailableItems` because that
   * list also feeds the unrelated pledge-fulfil "Z moich rzeczy" picker,
   * which must keep offering every AVAILABLE personal item regardless of
   * its listing tag. */
  mySwapAvailableItems: AvailableItem[];
  /** The caller's own active `TermAttendance` for `currentTerm`, or `null`
   * when they haven't RSVP'd (or there's no current Term). Gates visibility
   * of the "list/browse/take" section — see spec.md's Verification note. */
  myAttendanceForCurrentTerm: MyAttendanceResponse | null;
  /** "Twoje wystawione rzeczy" — the caller's own listings on `currentTerm`. */
  myItemListings: BrowseTermItemListingResponse[];
  /** "Rzeczy od innych" — other attendees' still-takeable listings on `currentTerm`. */
  browseListings: BrowseTermItemListingResponse[];
  pledgeFamilyName: (pledge: PledgeResponse) => string;
  pledge: (neededItemId: number) => Promise<void>;
  withdraw: (pledgeId: number) => Promise<void>;
  fulfillPledgeItem: (pledgeId: number, request: FulfillPledgeRequest) => Promise<void>;
  confirmPledgeReceipt: (pledgeId: number, reservationId: number) => Promise<void>;
  /** Takes another attendee's (or the organizer's) offered item for
   * `currentTerm`. `offeredItemId` is required for, and only meaningful
   * for, a `SWAP`. */
  takeListing: (
    itemId: number,
    reservationType: ReservationType,
    offeredItemId?: number,
  ) => Promise<void>;
  /** Proposes a swap: the caller's own `offeredItemId` for `itemId` (the
   * target listing) on `currentTerm`. Unlike `takeListing`'s LEND/GIFT
   * path, this never creates a Reservation on the listing item itself —
   * the owner must `accept`/`reject` first (Group 5's propose/accept/
   * reject flow) — so there is no immediate "taken" result to return. */
  proposeSwap: (itemId: number, offeredItemId: number) => Promise<void>;
  withdrawMyAttendance: () => Promise<void>;
  /** Confirms receipt of a term-page listing's reservation via the shared
   * `confirmTransaction` endpoint (also used by the global pending-actions
   * modal) — `termId` is caller-supplied context so the backend can gate on
   * `term.occurs_on`. Unlike `confirmPledgeReceipt`, this never goes through
   * `fulfillReservation`: a bare fulfill has no term-end/race check and,
   * for SWAP, only ever resolves one leg of the pair. */
  confirmListingReceipt: (reservationId: number, termId: number) => Promise<void>;
  refetch: () => Promise<void>;
}

/** Groups this Circle's individual (per-guardian/child) `Membership` rows
 * back into Families for display — each family member joins a Circle
 * individually now (see `app.groups.models.Membership`'s docstring), so
 * several memberships can point at the same Family. */
async function resolveFamiliesForMemberships(
  memberPartyIds: number[],
): Promise<KragFamily[]> {
  const familiesById = new Map<number, KragFamily>();
  for (const partyId of memberPartyIds) {
    const families = await getFamiliesForGuardianParty(partyId);
    const family = families[0];
    if (!family || familiesById.has(family.id)) continue;
    const guardians = await getGuardians(family.id);
    familiesById.set(family.id, { familyId: family.id, name: family.name, guardians });
  }
  return Array.from(familiesById.values());
}

export function useKragGrupy(groupId: number): UseKragGrupyResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupResponse | null>(null);
  const [organizer, setOrganizer] = useState<UserProfileResponse | null>(null);
  const [families, setFamilies] = useState<KragFamily[]>([]);
  const [currentTerm, setCurrentTerm] = useState<TermResponse | null>(null);
  const [neededItems, setNeededItems] = useState<KragNeededItemWithPledges[]>([]);
  const [myAvailableItems, setMyAvailableItems] = useState<AvailableItem[]>([]);
  const [mySwapAvailableItems, setMySwapAvailableItems] = useState<AvailableItem[]>([]);
  const [myPartyId, setMyPartyId] = useState<number | null>(null);
  const [attendances, setAttendances] = useState<MyAttendanceResponse[]>([]);
  const [myItemListings, setMyItemListings] = useState<BrowseTermItemListingResponse[]>([]);
  const [browseListings, setBrowseListings] = useState<BrowseTermItemListingResponse[]>([]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupData, leadership, memberships, terms, myProfile, productsData, attendancesData] =
        await Promise.all([
          getGroup(groupId),
          getCurrentLeadership(groupId),
          getMembershipsForCircle(groupId),
          getTerms(groupId),
          getMyProfile(),
          getProducts(),
          getMyAttendances(),
        ]);
      setMyPartyId(myProfile.party_id);
      setGroup(groupData);
      setOrganizer(leadership ? await getProfileByParty(leadership.organizer_party_id) : null);
      setFamilies(await resolveFamiliesForMemberships(memberships.map((m) => m.member_party_id)));
      setAttendances(attendancesData);

      // The pledger's own AVAILABLE personal items — offered as "z moich
      // rzeczy" in the fulfil form, and as the pool a lister can list from
      // in "Wystaw rzecz". Bounded per-item balance fetch, same shape as
      // `resolveFamiliesForMemberships` above. Deliberately NOT filtered by
      // `ItemListingPreference` — fulfilling a pledge ("bringing" a needed
      // item) is unrelated to an item's standing lend/gift/swap tag, so this
      // list must keep offering every AVAILABLE personal item.
      //
      // `mySwapAvailableItems` below is a separate, narrower derivation for
      // the SWAP counter-offer picker (`SwapProposeDialog`), which — unlike
      // the pledge-fulfil pool — must only offer items the caller has tagged
      // "zamienię" (`ItemListingPreference.mode === "SWAP"`), mirroring the
      // backend's parallel enforcement in `_require_own_available_personal_item`.
      if (myProfile.account_user_id != null) {
        const inventories = await getInventories(myProfile.account_user_id);
        const personal = inventories.find((inv) => inv.inventory_type === "PERSONAL") ?? null;
        if (personal) {
          const [items, preferences] = await Promise.all([
            getInventoryItems(personal.id),
            getMyItemListingPreferences(),
          ]);
          const withStatus = await Promise.all(
            items.map(async (it) => ({ it, balance: await getInventoryItemBalance(it.id) })),
          );
          const available = withStatus.filter(({ balance }) => balance.status === "AVAILABLE");
          const toAvailableItem = ({ it }: (typeof available)[number]): AvailableItem => ({
            id: it.id,
            productName: productsData.find((p) => p.id === it.product_id)?.name ?? `Rzecz #${it.id}`,
          });
          setMyAvailableItems(available.map(toAvailableItem));

          const swapTaggedItemIds = new Set(
            preferences.filter((p) => p.mode === "SWAP").map((p) => p.item_id),
          );
          setMySwapAvailableItems(
            available.filter(({ it }) => swapTaggedItemIds.has(it.id)).map(toAvailableItem),
          );
        } else {
          setMyAvailableItems([]);
          setMySwapAvailableItems([]);
        }
      } else {
        setMyAvailableItems([]);
        setMySwapAvailableItems([]);
      }

      // Newest Term first (backend orders desc by occurs_on) — treated as
      // "the current/next class" for this simplified view.
      const term = terms[0] ?? null;
      setCurrentTerm(term);

      if (term) {
        const items = await getNeededItems(term.id);
        const withPledges = await Promise.all(
          items.map(async (item) => ({ item, pledges: await getPledges(item.id) })),
        );
        setNeededItems(withPledges);
      } else {
        setNeededItems([]);
      }

      // "List/browse/take" data — only relevant once the caller has their
      // own active TermAttendance for `term`, or is the Term's Circle
      // organizer (who never RSVPs to their own Term but must still see
      // their own moded items there); fetching it unconditionally would be
      // meaningless for every other viewer.
      const myAttendance = term ? attendancesData.find((a) => a.term_id === term.id) ?? null : null;
      const isOrganizerViewer = leadership !== null && leadership.organizer_party_id === myProfile.party_id;
      if (term && (myAttendance || isOrganizerViewer)) {
        const [mine, browse] = await Promise.all([
          getMyTermItemListings(term.id),
          getBrowseTermItemListings(term.id),
        ]);
        setMyItemListings(mine);
        setBrowseListings(browse);
      } else {
        setMyItemListings([]);
        setBrowseListings([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nie udalo sie wczytac danych grupy");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const pledgeFamilyName = useCallback(
    (pledgeItem: PledgeResponse): string => {
      const family = families.find((f) =>
        f.guardians.some((g) => g.party_id === pledgeItem.pledged_by_party_id),
      );
      return family ? family.name : "Inna rodzina";
    },
    [families],
  );

  const pledge = useCallback(
    async (neededItemId: number) => {
      await createPledge(neededItemId);
      await refetch();
    },
    [refetch],
  );

  const withdraw = useCallback(
    async (pledgeId: number) => {
      await withdrawPledge(pledgeId);
      await refetch();
    },
    [refetch],
  );

  const fulfillPledgeItem = useCallback(
    async (pledgeId: number, request: FulfillPledgeRequest) => {
      await fulfillPledge(pledgeId, request);
      await refetch();
    },
    [refetch],
  );

  // Shared by the existing pledge-confirm flow and the listing-take flow.
  // Both reservations are already `CONFIRMED` by the time this runs — the
  // backend auto-confirms on behalf of the holder right at creation, since
  // their consent already exists (a published `ItemListingPreference`, or
  // the guardian's own act of registering the pledged item) — so this is
  // just the receiving party's later "I physically got it" step.
  const confirmReservationReceipt = useCallback(async (reservationId: number) => {
    await fulfillReservation(reservationId);
  }, []);

  const confirmPledgeReceipt = useCallback(
    async (pledgeId: number, reservationId: number) => {
      await confirmReservationReceipt(reservationId);
      await syncPledgeFulfillment(pledgeId);
      await refetch();
    },
    [confirmReservationReceipt, refetch],
  );

  const confirmListingReceipt = useCallback(
    async (reservationId: number, termId: number) => {
      await confirmTransaction(reservationId, { term_id: termId });
      await refetch();
    },
    [refetch],
  );

  const myAttendanceForCurrentTerm = currentTerm
    ? attendances.find((a) => a.term_id === currentTerm.id) ?? null
    : null;

  const takeListing = useCallback(
    async (itemId: number, reservationType: ReservationType, offeredItemId?: number) => {
      if (!currentTerm) return;
      const request: TakeTermItemListingRequest =
        reservationType === "SWAP"
          ? { term_id: currentTerm.id, reservation_type: reservationType, offered_item_id: offeredItemId }
          : { term_id: currentTerm.id, reservation_type: reservationType };
      await takeTermItemListing(itemId, request);
      await refetch();
    },
    [currentTerm, refetch],
  );

  const proposeSwap = useCallback(
    async (itemId: number, offeredItemId: number) => {
      if (!currentTerm) return;
      await proposeSwapApi(itemId, { term_id: currentTerm.id, offered_item_id: offeredItemId });
      await refetch();
    },
    [currentTerm, refetch],
  );

  const withdrawMyAttendance = useCallback(async () => {
    if (!myAttendanceForCurrentTerm) return;
    await withdrawMyAttendanceApi(myAttendanceForCurrentTerm.attendance_id);
    await refetch();
  }, [myAttendanceForCurrentTerm, refetch]);

  return {
    loading,
    error,
    group,
    organizer,
    families,
    myPartyId,
    currentTerm,
    neededItems,
    myAvailableItems,
    mySwapAvailableItems,
    myAttendanceForCurrentTerm,
    myItemListings,
    browseListings,
    pledgeFamilyName,
    pledge,
    withdraw,
    fulfillPledgeItem,
    confirmPledgeReceipt,
    takeListing,
    proposeSwap,
    withdrawMyAttendance,
    confirmListingReceipt,
    refetch,
  };
}
