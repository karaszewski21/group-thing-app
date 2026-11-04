import { useState } from "react";
import { getMyFamilies } from "../../../api/families";
import { createRsvp } from "../../../api/groups";
import { serverMessageOr } from "../../../api/problem";
import { pluralPl } from "../../../utils/plural";
import { useAccountGate, type TermActionDeps } from "../../auth/useAccountGate";

/** Footer sign-up, which needs an account: an anonymous visitor gets the
 * login/register sheet. A logged-in parent whose family already has
 * children is signed up straight away with that child count; only a family
 * with no children yet (or an unreadable one) gets the dialog, which asks
 * for the count. */
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

  function handleSubmitted(toast = "Zapisano na zajęcia") {
    setDialogOpen(false);
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
      await createRsvp(groupId, { term_id: termId, child_count: childCount });
      handleSubmitted(
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
    dialogOpen,
    signingUp,
    openSignUp: gate.guard(signUpLoggedIn),
    closeDialog: () => setDialogOpen(false),
    handleSubmitted: () => handleSubmitted(),
  };
}
