import { useCallback, useEffect, useState } from "react";
import { getFamiliesForGuardianParty, getGuardians, type GuardianResponse } from "../api/families";
import { getCurrentLeadership, getGroup, getMembershipsForCircle, type GroupResponse } from "../api/groups";
import {
  createPledge,
  fulfillPledge,
  getPledges,
  syncPledgeFulfillment,
  withdrawPledge,
  type FulfillPledgeRequest,
  type PledgeResponse,
} from "../api/pledges";
import {
  getInventories,
  getInventoryItemBalance,
  getInventoryItems,
} from "../api/inventories";
import { getMyProfile, getProfileByParty, type UserProfileResponse } from "../api/people";
import { getProducts } from "../api/products";
import { confirmReservation, fulfillReservation } from "../api/reservations";
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
  pledgeFamilyName: (pledge: PledgeResponse) => string;
  pledge: (neededItemId: number) => Promise<void>;
  withdraw: (pledgeId: number) => Promise<void>;
  fulfillPledgeItem: (pledgeId: number, request: FulfillPledgeRequest) => Promise<void>;
  confirmPledgeReceipt: (pledgeId: number, reservationId: number) => Promise<void>;
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

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupData, leadership, memberships, terms, myProfile, productsData] = await Promise.all([
        getGroup(groupId),
        getCurrentLeadership(groupId),
        getMembershipsForCircle(groupId),
        getTerms(groupId),
        getMyProfile(),
        getProducts(),
      ]);
      setMyPartyId(myProfile.party_id);
      setGroup(groupData);
      setOrganizer(leadership ? await getProfileByParty(leadership.organizer_party_id) : null);
      setFamilies(await resolveFamiliesForMemberships(memberships.map((m) => m.member_party_id)));

      // The pledger's own AVAILABLE personal items — offered as "z moich
      // rzeczy" in the fulfil form. Bounded per-item balance fetch, same
      // shape as `resolveFamiliesForMemberships` above.
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

  const confirmPledgeReceipt = useCallback(
    async (pledgeId: number, reservationId: number) => {
      await confirmReservation(reservationId);
      await fulfillReservation(reservationId);
      await syncPledgeFulfillment(pledgeId);
      await refetch();
    },
    [refetch],
  );

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
    pledgeFamilyName,
    pledge,
    withdraw,
    fulfillPledgeItem,
    confirmPledgeReceipt,
    refetch,
  };
}
