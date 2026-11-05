"use client";

import { AuthSheet } from "../../auth/AuthSheet";
import { TermFooter } from "../components/TermFooter";
import { useTermSignUp } from "../hooks/useTermSignUp";
import { RsvpDialogLoggedIn } from "../modals/RsvpDialogLoggedIn";
import { useTermPage } from "../TermPageContext";

/** The sticky sign-up footer with its login sheet and RSVP dialog; nothing
 * without a term. */
export function TermSignUp() {
  const { view, isLoggedIn, displayName, refetch, showToast } = useTermPage();
  const { group, isAttending } = view;
  const term = group.term;
  const signUp = useTermSignUp({
    isLoggedIn,
    refetch,
    showToast,
    groupId: group.id,
    termId: term?.id ?? null,
    displayName,
  });
  if (!term) return null;

  return (
    <>
      <TermFooter
        isLoggedIn={isLoggedIn}
        isAttending={isAttending}
        busy={signUp.signingUp}
        onSignUp={signUp.openSignUp}
      />
      {signUp.gateOpen && (
        <AuthSheet
          title="Zapisz się na zajęcia"
          message="Zapisy na zajęcia wymagają konta. Zaloguj się albo załóż konto — zostaniesz na tej stronie."
          onClose={signUp.closeGate}
        />
      )}
      {signUp.dialogOpen && isLoggedIn && (
        <RsvpDialogLoggedIn
          groupId={group.id}
          termId={term.id}
          displayName={displayName}
          onClose={signUp.closeDialog}
          onSubmitted={signUp.handleSubmitted}
        />
      )}
    </>
  );
}
