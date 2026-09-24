import { useState } from "react";
import { ApiError } from "../../../api/client";
import { createPledge } from "../../../api/pledges";
import { useAccountGate, type TermActionDeps } from "./useAccountGate";

/** "Ja to przyniosę" on a needed item. A 409 means someone else pledged it
 * first, so the page refetches to show who. */
export function useNeededItemPledge({ isLoggedIn, refetch, showToast }: TermActionDeps) {
  const gate = useAccountGate(isLoggedIn);
  const [pledgedItemIds, setPledgedItemIds] = useState<number[]>([]);
  const [pledgingItemId, setPledgingItemId] = useState<number | null>(null);

  async function performPledge(neededItemId: number) {
    setPledgingItemId(neededItemId);
    try {
      await createPledge(neededItemId);
      setPledgedItemIds((prev) => [...prev, neededItemId]);
      showToast("Zgłoszono — szczegóły w Twoim panelu");
      await refetch();
    } catch (err) {
      const conflict = err instanceof ApiError && err.status === 409;
      showToast(conflict ? "Ktoś już zadeklarował przyniesienie tej rzeczy" : "Nie udało się zapisać zgłoszenia");
      if (conflict) await refetch();
    } finally {
      setPledgingItemId(null);
    }
  }

  return {
    gateOpen: gate.isOpen,
    closeGate: gate.close,
    pledge: gate.guard(performPledge),
    pledgingItemId,
    /** Pledged in this session, before the refetch reports it as claimed. */
    isPledgedHere: (neededItemId: number) => pledgedItemIds.includes(neededItemId),
  };
}
