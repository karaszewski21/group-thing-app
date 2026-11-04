import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationState } from "../../../routing/navigation";
import type { ModalKind, PickedLocationState } from "../../../utils/appHelpers";
import type { TermDraft } from "../termDraft";

/** The stepper's place picker id; /places/new hands it back in its state. */
export const FIRST_TERM_PICKER = "first-term-place";

/** The first-term stepper's draft and its lifecycle in the panel:
 * - opening the stepper from its trigger starts from `defaults` (the group's place and capacity);
 * - "+" (`closeStepperForPlace`) closes it for /places/new and keeps the draft;
 * - coming back from /places/new — saved or cancelled — reopens it once per
 *   handed-back state, with a saved place selected;
 * - ✕/Esc/backdrop and finishing (`closeStepper`) drop the draft. */
export function useFirstTermStepper(setModal: (modal: ModalKind) => void, defaults: TermDraft) {
  const [draft, setDraft] = useState<TermDraft | null>(null);
  // Only the stepper's own pick: state handed to a page's picker stays for it.
  const picked = useNavigationState<PickedLocationState>(
    (state) => state.pickedLocation?.picker === FIRST_TERM_PICKER,
  )?.pickedLocation;
  const handledPick = useRef<PickedLocationState["pickedLocation"] | null>(null);

  // The panel keeps reading the same state object until the URL changes, so
  // without the guard any re-render would reopen a closed stepper.
  useEffect(() => {
    if (picked?.picker !== FIRST_TERM_PICKER || handledPick.current === picked) return;
    handledPick.current = picked;
    const { locationId } = picked;
    if (locationId !== null) setDraft((current) => ({ ...(current ?? defaults), locationId }));
    setModal("pierwszy-termin");
  }, [picked, defaults, setModal]);

  const openStepper = useCallback(() => {
    setDraft(null);
    setModal("pierwszy-termin");
  }, [setModal]);

  const closeStepper = useCallback(() => {
    setDraft(null);
    setModal(null);
  }, [setModal]);

  const closeStepperForPlace = useCallback(() => setModal(null), [setModal]);

  return {
    firstTermDraft: draft ?? defaults,
    setFirstTermDraft: setDraft,
    openStepper,
    closeStepper,
    closeStepperForPlace,
  };
}
