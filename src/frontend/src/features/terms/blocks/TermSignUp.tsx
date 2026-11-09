"use client";

import { SignUpFooter } from "../../../components/shared/SignUpFooter";
import { useTermSignUp } from "../hooks/useTermSignUp";
import { RsvpDialogLoggedIn } from "../modals/RsvpDialogLoggedIn";
import { useTermPage } from "../TermPageContext";

/** The sticky sign-up footer with its RSVP dialog; nothing without a term
 * or once the viewer attends. */
export function TermSignUp() {
  const { view, isLoggedIn, displayName, refetch, showToast } = useTermPage();
  const { group, isAttending } = view;
  const term = group.term;
  const signUp = useTermSignUp({
    refetch,
    showToast,
    groupId: group.id,
    termId: term?.id ?? null,
    displayName,
  });
  if (!term || isAttending) return null;

  return (
    <>
      <SignUpFooter
        variant="signUp"
        isLoggedIn={isLoggedIn}
        authMessage="Zapisy na zajęcia wymagają konta. Zaloguj się albo załóż konto — zostaniesz na tej stronie."
        onSignUp={signUp.signUp}
      />
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
