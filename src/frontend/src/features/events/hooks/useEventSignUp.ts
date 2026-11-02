import { useState } from "react";
import { eventGuestProfileKey, type EventAttendanceResponse } from "../../../api/events";
import { readValidGuestProfile, writeGuestProfile } from "../../../api/groups";

const SIGNED_UP_TOAST = "Zapisano na wydarzenie";

interface UseEventSignUpDeps {
  eventId: string;
  isLoggedIn: boolean;
  /** `useEvent`'s writes; both reject with an `Error` carrying Polish copy. */
  signUp: (guestName: string | null) => Promise<EventAttendanceResponse>;
  withdraw: () => Promise<void>;
  showToast: (message: string) => void;
}

/** Sign-up and withdraw on the event page: one click for a logged-in viewer,
 * the guest sheet for an anonymous one (whose sign-up is remembered under the
 * event's guest key), and the withdraw confirmation. */
export function useEventSignUp({ eventId, isLoggedIn, signUp, withdraw, showToast }: UseEventSignUpDeps) {
  const [guestProfileId, setGuestProfileId] = useState(() =>
    isLoggedIn ? null : readValidGuestProfile(eventGuestProfileKey(eventId)),
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);

  async function signUpLoggedIn() {
    if (signingUp) return;
    setSigningUp(true);
    try {
      await signUp(null);
      showToast(SIGNED_UP_TOAST);
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setSigningUp(false);
    }
  }

  /** Rejects with the message the sheet shows inline. */
  async function submitGuest(name: string) {
    const guestName = name.trim();
    if (!guestName) throw new Error("Podaj swoje imię.");
    const attendance = await signUp(guestName);
    writeGuestProfile(eventGuestProfileKey(eventId), attendance.user_profile_id);
    setGuestProfileId(attendance.user_profile_id);
    setSheetOpen(false);
    showToast(SIGNED_UP_TOAST);
  }

  /** Rejects with the message the confirm dialog shows. */
  async function confirmWithdraw() {
    await withdraw();
    setConfirmingWithdraw(false);
    showToast("Wypisano z wydarzenia");
  }

  return {
    guestProfileId,
    signingUp,
    openSignUp: () => (isLoggedIn ? void signUpLoggedIn() : setSheetOpen(true)),
    sheetOpen,
    closeSheet: () => setSheetOpen(false),
    submitGuest,
    confirmingWithdraw,
    openWithdraw: () => setConfirmingWithdraw(true),
    closeWithdraw: () => setConfirmingWithdraw(false),
    confirmWithdraw,
  };
}
