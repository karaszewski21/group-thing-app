"use client";

import { ConfirmDeleteDialog } from "../../../components/shared/ConfirmDeleteDialog";
import { SignUpFooter } from "../../../components/shared/SignUpFooter";
import { useEventPage } from "../EventPageContext";
import { useEventSignUp } from "../hooks/useEventSignUp";

/** The sticky footer with its withdraw dialog: sign up for a visitor,
 * withdraw for an attendee, a notice once the event has ended. */
export function EventSignUp() {
  const { view, actions, isLoggedIn, showToast } = useEventPage();
  const signUp = useEventSignUp({ signUp: actions.signUp, withdraw: actions.withdraw, showToast });

  if (view.kind !== "visitor" && view.kind !== "attendee") return null;
  if (view.ended) return <SignUpFooter variant="ended" label="Wydarzenie się zakończyło" />;
  if (view.kind === "visitor") {
    return (
      <SignUpFooter
        variant="signUp"
        isLoggedIn={isLoggedIn}
        authMessage="Zapisy na wydarzenie wymagają konta. Zaloguj się albo załóż konto — zostaniesz na tej stronie."
        onSignUp={signUp.signUp}
      />
    );
  }
  return (
    <>
      <SignUpFooter variant="withdraw" onWithdraw={signUp.openWithdraw} />
      {signUp.confirmingWithdraw && (
        <ConfirmDeleteDialog
          title="Wypisać się z wydarzenia?"
          body="Znikniesz z listy zapisanych i stracisz dostęp do czatu wydarzenia."
          confirmLabel="Wypisz się"
          tone="primary"
          busyLabel="Wypisywanie…"
          fallbackError="Nie udało się wypisać. Spróbuj ponownie."
          onConfirm={signUp.confirmWithdraw}
          onClose={signUp.closeWithdraw}
        />
      )}
    </>
  );
}
