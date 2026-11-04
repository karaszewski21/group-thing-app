import { useState } from "react";
import type { EventAttendanceResponse } from "../../../api/events";
import { useAccountGate } from "../../auth/useAccountGate";

interface UseEventSignUpDeps {
  isLoggedIn: boolean;
  /** `useEvent`'s writes; both reject with an `Error` carrying Polish copy. */
  signUp: () => Promise<EventAttendanceResponse>;
  withdraw: () => Promise<void>;
  showToast: (message: string) => void;
}

/** Sign-up and withdraw on the event page. Signing up needs an account: one
 * click for a logged-in viewer, the login/register sheet for an anonymous
 * one. Withdrawing goes through a confirmation. */
export function useEventSignUp({ isLoggedIn, signUp, withdraw, showToast }: UseEventSignUpDeps) {
  const gate = useAccountGate(isLoggedIn);
  const [signingUp, setSigningUp] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);

  async function signUpLoggedIn() {
    if (signingUp) return;
    setSigningUp(true);
    try {
      await signUp();
      showToast("Zapisano na wydarzenie");
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setSigningUp(false);
    }
  }

  /** Rejects with the message the confirm dialog shows. */
  async function confirmWithdraw() {
    await withdraw();
    setConfirmingWithdraw(false);
    showToast("Wypisano z wydarzenia");
  }

  return {
    signingUp,
    openSignUp: gate.guard(signUpLoggedIn),
    gateOpen: gate.isOpen,
    closeGate: gate.close,
    confirmingWithdraw,
    openWithdraw: () => setConfirmingWithdraw(true),
    closeWithdraw: () => setConfirmingWithdraw(false),
    confirmWithdraw,
  };
}
