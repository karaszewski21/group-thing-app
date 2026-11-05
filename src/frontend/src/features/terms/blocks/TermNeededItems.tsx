"use client";

import type { PublicCircleResponse } from "../../../api/groups";
import { AuthSheet } from "../../auth/AuthSheet";
import { NeededItemsSection } from "../components/NeededItemsSection";
import type { NeededItemRowVM } from "../components/termSectionTypes";
import { useNeededItemPledge } from "../hooks/useNeededItemPledge";
import { useTermPage } from "../TermPageContext";

function buildRows(
  items: NonNullable<PublicCircleResponse["term"]>["needed_items"],
  pledge: ReturnType<typeof useNeededItemPledge>,
  displayName: string | null,
): NeededItemRowVM[] {
  return items.map((item) => {
    const pledgedHere = pledge.isPledgedHere(item.id);
    const claimed = item.claimed || pledgedHere;
    const claimedByMe = pledgedHere || (displayName !== null && item.claimed_by_name === displayName);
    return {
      key: item.id,
      title: (
        <strong>
          {item.name}
          {item.description ? ` — ${item.description}` : ""}
        </strong>
      ),
      subtitle: claimed ? `Przynosi: ${claimedByMe ? "Ty" : (item.claimed_by_name ?? "inna rodzina")}` : null,
      inlineActions: !claimed
        ? [
            {
              key: "pledge",
              label: "Ja to przyniosę",
              ariaLabel: `Ja to przyniosę: ${item.name}`,
              disabled: pledge.pledgingItemId === item.id,
              onClick: () => pledge.pledge(item.id),
            },
          ]
        : [],
    };
  });
}

/** What the organizer asks to bring, with the pledge and its login sheet;
 * nothing when they ask for nothing. */
export function TermNeededItems() {
  const { view, isLoggedIn, displayName, refetch, showToast } = useTermPage();
  const pledge = useNeededItemPledge({ isLoggedIn, refetch, showToast });
  const items = view.group.term?.needed_items ?? [];
  if (items.length === 0) return null;

  return (
    <>
      <NeededItemsSection rows={buildRows(items, pledge, displayName)} />
      {pledge.gateOpen && (
        <AuthSheet
          message="Żeby zgłosić, że przyniesiesz coś na zajęcia, musisz mieć konto — dzięki temu organizator wie, kto co przynosi, a rzecz trafia do Twoich zbiorów."
          onClose={pledge.closeGate}
        />
      )}
    </>
  );
}
