import { useState } from "react";
import { getMyFamilies } from "../../../api/families";
import { createRsvp, type RsvpResponse } from "../../../api/groups";
import { serverMessageOr } from "../../../api/problem";
import { pluralPl } from "../../../utils/plural";
import { useAccountGate, type TermActionDeps } from "./useAccountGate";

/** Footer sign-up. Anonymous visitors first choose: log in / register, or
 * continue as a guest (`continueAsGuest`). A logged-in parent whose family
 * already has children is signed up straight away with that child count;
 * only a family with no children yet (or an unreadable one) gets the
 * logged-in dialog, which asks for the count. */
export function useTermSignUp({
  isLoggedIn,
  refetch,
  showToast,
  groupId,
  termId,
  displayName,
}: TermActionDeps & { groupId: string; termId: string | null; displayName: string | null }) {
  const gate = useAccountGate(isLoggedIn);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  // The RSVP just submitted this session — drives the post-guest-RSVP
  // account suggestion (only when `attached_to_account === false`).
  const [lastRsvp, setLastRsvp] = useState<RsvpResponse | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  function continueAsGuest() {
    gate.close();
    setDialogOpen(true);
  }

  function handleSubmitted(rsvp: RsvpResponse, toast = "Zapisano na zajęcia") {
    setDialogOpen(false);
    setLastRsvp(rsvp);
    showToast(toast);
    void refetch();
  }

  async function familyChildCount(): Promise<number> {
    try {
      return (await getMyFamilies())[0]?.child_count ?? 0;
    } catch {
      return 0;
    }
  }

  async function signUpLoggedIn() {
    if (termId === null || signingUp) return;
    // The display name loads after login; the dialog waits for it.
    if (displayName === null) {
      setDialogOpen(true);
      return;
    }
    setSigningUp(true);
    try {
      const childCount = await familyChildCount();
      if (childCount < 1) {
        setDialogOpen(true);
        return;
      }
      const rsvp = await createRsvp(groupId, {
        term_id: termId,
        guardian_name: displayName,
        child_count: childCount,
      });
      handleSubmitted(
        rsvp,
        `Zapisano na zajęcia z ${childCount} ${pluralPl(childCount, "dzieckiem", "dziećmi", "dziećmi")}`,
      );
    } catch (err) {
      showToast(serverMessageOr(err, "Nie udało się zapisać — spróbuj ponownie"));
    } finally {
      setSigningUp(false);
    }
  }

  return {
    gateOpen: gate.isOpen,
    closeGate: gate.close,
    continueAsGuest,
    dialogOpen,
    signingUp,
    openSignUp: gate.guard(signUpLoggedIn),
    closeDialog: () => setDialogOpen(false),
    handleSubmitted: (rsvp: RsvpResponse) => handleSubmitted(rsvp),
    /** The guest RSVP to offer turning into an account, if any. */
    accountSuggestion: lastRsvp && !lastRsvp.attached_to_account && !suggestionDismissed ? lastRsvp : null,
    dismissSuggestion: () => setSuggestionDismissed(true),
  };
}
