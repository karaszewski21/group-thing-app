import { useState } from "react";
import type { EventAttendanceResponse } from "../../../api/events";

interface UseEventSignUpDeps {
  /** `useEvent`'s writes; both reject with an `Error` carrying Polish copy. */
  signUp: () => Promise<EventAttendanceResponse>;
  withdraw: () => Promise<void>;
  showToast: (message: string) => void;
}

/** Sign-up and withdraw on the event page. Signing up is the logged-in side
 * of the footer's "Zapisz się" (`SignUpFooter` gates anonymous visitors);
 * withdrawing goes through a confirmation. */
export function useEventSignUp({ signUp, withdraw, showToast }: UseEventSignUpDeps) {
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);

  async function signUpLoggedIn() {
    try {
      await signUp();
      showToast("Zapisano na wydarzenie");
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  /** Rejects with the message the confirm dialog shows. */
  async function confirmWithdraw() {
    await withdraw();
    setConfirmingWithdraw(false);
    showToast("Wypisano z wydarzenia");
  }

  return {
    signUp: signUpLoggedIn,
    confirmingWithdraw,
    openWithdraw: () => setConfirmingWithdraw(true),
    closeWithdraw: () => setConfirmingWithdraw(false),
    confirmWithdraw,
  };
}
