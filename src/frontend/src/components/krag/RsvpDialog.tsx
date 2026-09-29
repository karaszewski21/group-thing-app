import { useState } from "react";
import { createRsvp, guestProfileIdKey, writeGuestProfile, type RsvpResponse } from "../../api/groups";
import { Field } from "../../pages/panel/panelComponents";
import { ModalSheet } from "./ModalSheet";

/** Bottom-sheet RSVP form for an anonymous visitor — `ModalSheet`/`Field`
 * shared with `pages/panel` (Tailwind), `kg-input`/`kg-btn-primary` for the
 * form controls to match the rest of the term page's inputs/buttons. */
export function RsvpDialog({
  groupId,
  termId,
  onClose,
  onSubmitted,
}: {
  groupId: number;
  termId: number;
  onClose: () => void;
  onSubmitted: (rsvp: RsvpResponse) => void;
}) {
  const [guardianName, setGuardianName] = useState("");
  const [childCount, setChildCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!guardianName.trim()) {
      setFormError("Podaj imię");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const rsvp = await createRsvp(groupId, {
        term_id: termId,
        guardian_name: guardianName.trim(),
        child_count: childCount,
      });
      writeGuestProfile(guestProfileIdKey(groupId, termId), rsvp.user_profile_id);
      onSubmitted(rsvp);
    } catch {
      setFormError("Nie udało się zapisać — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalSheet title="Zapisz się na zajęcia" onClose={onClose}>
      <div className="mb-3.5">
        <Field label="Imię">
          <input
            id="rsvp-name"
            className="kg-input"
            placeholder="np. Ania Kowalska"
            value={guardianName}
            onChange={(e) => setGuardianName(e.target.value)}
          />
        </Field>
      </div>

      <div className="mb-3.5">
        <Field label="Liczba dzieci">
          <input
            id="rsvp-children"
            className="kg-input"
            type="number"
            min={0}
            value={childCount}
            onChange={(e) => setChildCount(Math.max(0, Number(e.target.value) || 0))}
          />
        </Field>
      </div>

      {formError && <div className="mb-2.5 text-xs text-danger">{formError}</div>}

      <button
        className="kg-btn-primary w-full px-3.5 py-2.5 text-[13px]"
        disabled={busy}
        onClick={() => void handleSubmit()}
      >
        Zapisz się
      </button>
    </ModalSheet>
  );
}
