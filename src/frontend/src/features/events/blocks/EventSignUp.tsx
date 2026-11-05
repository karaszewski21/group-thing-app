"use client";

import { ConfirmDeleteDialog } from "../../../components/shared/ConfirmDeleteDialog";
import { AuthSheet } from "../../auth/AuthSheet";
import { EventFooter } from "../components/EventFooter";
import { useEventPage } from "../EventPageContext";
import { useEventSignUp } from "../hooks/useEventSignUp";

/** The sticky footer with its login sheet and withdraw dialog: sign up for a
 * visitor, withdraw for an attendee, a notice once the event has ended. */
export function EventSignUp() {
  const { view, actions, isLoggedIn, showToast } = useEventPage();
  const signUp = useEventSignUp({
    isLoggedIn,
    signUp: actions.signUp,
    withdraw: actions.withdraw,
    showToast,
  });

  if (view.kind === "attendee") {
    return (
      <>
        {view.ended ? (
          <EventFooter variant="ended" />
        ) : (
          <EventFooter variant="withdraw" busy={false} onWithdraw={signUp.openWithdraw} />
        )}
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
  if (view.kind === "visitor") {
    return (
      <>
        {view.ended ? (
          <EventFooter variant="ended" />
        ) : (
          <EventFooter variant="signUp" busy={signUp.signingUp} onSignUp={signUp.openSignUp} />
        )}
        {signUp.gateOpen && (
          <AuthSheet
            title="Zapisz się na wydarzenie"
            message="Zapisy na wydarzenie wymagają konta. Zaloguj się albo załóż konto — zostaniesz na tej stronie."
            onClose={signUp.closeGate}
          />
        )}
      </>
    );
  }
  return null;
}
