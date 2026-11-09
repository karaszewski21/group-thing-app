import { useState } from "react";
import { getMyFamilies } from "../../../api/families";
import { createRsvp } from "../../../api/groups";
import { serverMessageOr } from "../../../api/problem";
import { pluralPl } from "../../../utils/plural";
import type { TermActionDeps } from "../../auth/useAccountGate";

/** The logged-in side of the footer's "Zapisz się" (`SignUpFooter` gates
 * anonymous visitors). A parent whose family already has
 * children is signed up straight away with that child count; only a family
 * with no children yet (or an unreadable one) gets the dialog, which asks
 * for the count. */
export function useTermSignUp({
  refetch,
  showToast,
  groupId,
  termId,
  displayName,
}: Omit<TermActionDeps, "isLoggedIn"> & { groupId: string; termId: string | null; displayName: string | null }) {
  const [dialogOpen, setDialogOpen] = useState(false);

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

  async function signUp() {
    if (termId === null) return;
    // The display name loads after login; the dialog waits for it.
    if (displayName === null) {
      setDialogOpen(true);
      return;
    }
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
    }
  }

  return {
    dialogOpen,
    signUp,
    closeDialog: () => setDialogOpen(false),
    handleSubmitted: () => handleSubmitted(),
  };
}
