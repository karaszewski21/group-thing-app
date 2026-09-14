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
import { getMyProfile, getProfileByParty, type UserProfileResponse } from "../api/people";
import { getProducts } from "../api/products";
import { confirmReservation, fulfillReservation, type ReservationType } from "../api/reservations";
import {
  getBrowseTermItemListings,
  getMyTermItemListings,
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
  withdrawMyAttendance: () => Promise<void>;
  confirmListingReceipt: (reservationId: number) => Promise<void>;
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
      // `resolveFamiliesForMemberships` above.
      if (myProfile.account_user_id != null) {
        const inventories = await getInventories(myProfile.account_user_id);
        const personal = inventories.find((inv) => inv.inventory_type === "PERSONAL") ?? null;
        if (personal) {
          const items = await getInventoryItems(personal.id);
          const withStatus = await Promise.all(
            items.map(async (it) => ({ it, balance: await getInventoryItemBalance(it.id) })),
          );
          setMyAvailableItems(
            withStatus
              .filter(({ balance }) => balance.status === "AVAILABLE")
              .map(({ it }) => ({
                id: it.id,
                productName:
                  productsData.find((p) => p.id === it.product_id)?.name ?? `Rzecz #${it.id}`,
              })),
          );
        } else {
          setMyAvailableItems([]);
        }
      } else {
        setMyAvailableItems([]);
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

  // Shared by the existing pledge-confirm flow and the new listing-take
  // flow — both bridge a `Reservation` from CONFIRMED through FULFILLED
  // the same way; only what happens afterward differs.
  const confirmReservationReceipt = useCallback(async (reservationId: number) => {
    await confirmReservation(reservationId);
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
    async (reservationId: number) => {
      await confirmReservationReceipt(reservationId);
      await refetch();
    },
    [confirmReservationReceipt, refetch],
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
    myAttendanceForCurrentTerm,
    myItemListings,
    browseListings,
    pledgeFamilyName,
    pledge,
    withdraw,
    fulfillPledgeItem,
    confirmPledgeReceipt,
    takeListing,
    withdrawMyAttendance,
    confirmListingReceipt,
    refetch,
  };
}
