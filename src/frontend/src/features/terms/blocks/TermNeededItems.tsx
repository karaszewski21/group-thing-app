"use client";

import { useState } from "react";
import type { PublicCircleResponse } from "../../../api/groups";
import { AuthSheet } from "../../auth/AuthSheet";
import { NeededItemsSection } from "../components/NeededItemsSection";
import type { NeededItemRowVM } from "../components/termSectionTypes";
import { useNeededItemPledge } from "../hooks/useNeededItemPledge";
import { useTermSignUp } from "../hooks/useTermSignUp";
import { RsvpDialogLoggedIn } from "../modals/RsvpDialogLoggedIn";
import { SignUpToPledgeSheet } from "../modals/SignUpToPledgeSheet";
import { useTermPage } from "../TermPageContext";

type NeededItems = NonNullable<PublicCircleResponse["term"]>["needed_items"];

function buildRows(
  items: NeededItems,
  pledge: ReturnType<typeof useNeededItemPledge>,
  displayName: string | null,
  onPledge: ((item: NeededItems[number]) => void) | null,
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
      inlineActions:
        onPledge !== null && !claimed
          ? [
              {
                key: "pledge",
                label: "Ja to przyniosę",
                ariaLabel: `Ja to przyniosę: ${item.name}`,
                disabled: pledge.pledgingItemId === item.id,
                onClick: () => onPledge(item),
              },
            ]
          : [],
    };
  });
}

/** What the organizer asks to bring, with the pledge and its sheets;
 * nothing when they ask for nothing. Only someone taking part — an active
 * sign-up or a standing member — may pledge, as the backend enforces. An
 * anonymous visitor's "Ja to przyniosę" opens the login sheet, a logged-in
 * visitor who does not take part gets `SignUpToPledgeSheet`, whose sign-up
 * is the footer's; the organizer gets no button. */
export function TermNeededItems() {
  const { view, isLoggedIn, displayName, refetch, showToast } = useTermPage();
  const pledge = useNeededItemPledge({ isLoggedIn, refetch, showToast });
  const term = view.group.term;
  const signUp = useTermSignUp({
    refetch,
    showToast,
    groupId: view.group.id,
    termId: term?.id ?? null,
    displayName,
  });
  const [signUpPromptFor, setSignUpPromptFor] = useState<string | null>(null);
  const items = term?.needed_items ?? [];
  if (!term || items.length === 0) return null;

  const takesPart = view.isActiveAttendee || (view.isMember && !view.isOrganizer);
  const onPledge =
    view.isOrganizer && !takesPart
      ? null
      : (item: NeededItems[number]) => {
          if (isLoggedIn && !takesPart) setSignUpPromptFor(item.name);
          else pledge.pledge(item.id);
        };

  return (
    <>
      <NeededItemsSection rows={buildRows(items, pledge, displayName, onPledge)} />
      {pledge.gateOpen && (
        <AuthSheet
          message="Żeby zgłosić, że przyniesiesz coś na zajęcia, musisz mieć konto — dzięki temu organizator wie, kto co przynosi, a rzecz trafia do Twoich zbiorów."
          onClose={pledge.closeGate}
        />
      )}
      {signUpPromptFor !== null && (
        <SignUpToPledgeSheet
          itemName={signUpPromptFor}
          onClose={() => setSignUpPromptFor(null)}
          onSignUp={() => {
            setSignUpPromptFor(null);
            void signUp.signUp();
          }}
        />
      )}
      {signUp.dialogOpen && isLoggedIn && (
        <RsvpDialogLoggedIn
          groupId={view.group.id}
          termId={term.id}
          displayName={displayName}
          onClose={signUp.closeDialog}
          onSubmitted={signUp.handleSubmitted}
        />
      )}
    </>
  );
}
