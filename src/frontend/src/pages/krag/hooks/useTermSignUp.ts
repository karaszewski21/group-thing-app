import { useState } from "react";
import type { RsvpResponse } from "../../../api/groups";
import { useAccountGate, type TermActionDeps } from "./useAccountGate";

/** Footer sign-up. Anonymous visitors first choose: log in / register, or
 * continue as a guest (`continueAsGuest`). Logged-in users go straight to
 * the logged-in dialog. */
export function useTermSignUp({ isLoggedIn, refetch, showToast }: TermActionDeps) {
  const gate = useAccountGate(isLoggedIn);
  const [dialogOpen, setDialogOpen] = useState(false);
  // The RSVP just submitted this session — drives the post-guest-RSVP
  // account suggestion (only when `attached_to_account === false`).
  const [lastRsvp, setLastRsvp] = useState<RsvpResponse | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  function continueAsGuest() {
    gate.close();
    setDialogOpen(true);
  }

  function handleSubmitted(rsvp: RsvpResponse) {
    setDialogOpen(false);
    setLastRsvp(rsvp);
    showToast("Zapisano na zajęcia");
    void refetch();
  }

  return {
    gateOpen: gate.isOpen,
    closeGate: gate.close,
    continueAsGuest,
    dialogOpen,
    openSignUp: gate.guard(() => setDialogOpen(true)),
    closeDialog: () => setDialogOpen(false),
    handleSubmitted,
    /** The guest RSVP to offer turning into an account, if any. */
    accountSuggestion: lastRsvp && !lastRsvp.attached_to_account && !suggestionDismissed ? lastRsvp : null,
    dismissSuggestion: () => setSuggestionDismissed(true),
  };
}
