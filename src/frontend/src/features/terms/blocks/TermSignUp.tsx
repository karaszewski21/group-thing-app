"use client";

import { SignUpFooter } from "../../../components/shared/SignUpFooter";
import { useTermSignUp } from "../hooks/useTermSignUp";
import { RsvpDialogLoggedIn } from "../modals/RsvpDialogLoggedIn";
import { useTermPage } from "../TermPageContext";

/** The sticky sign-up footer with its RSVP dialog; nothing without a term.
 * An active attendee instead gets their own payment state when the term has
 * a price or they already paid, and nothing otherwise (withdrawing stays in
 * "Moje zajęcia"). */
export function TermSignUp() {
  const { view, isLoggedIn, displayName, refetch, showToast } = useTermPage();
  const { group, isAttending, paymentStatus } = view;
  const term = group.term;
  const signUp = useTermSignUp({
    refetch,
    showToast,
    groupId: group.id,
    termId: term?.id ?? null,
    displayName,
  });
  if (!term) return null;
  if (isAttending) {
    if (paymentStatus == null || (term.price == null && paymentStatus !== "PAID")) return null;
    return <SignUpFooter variant="payment" price={term.price} paymentUrl={term.payment_url} status={paymentStatus} />;
  }

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
          price={term.price}
          paymentUrl={term.payment_url}
          onClose={signUp.closeDialog}
          onSubmitted={signUp.handleSubmitted}
        />
      )}
    </>
  );
}
