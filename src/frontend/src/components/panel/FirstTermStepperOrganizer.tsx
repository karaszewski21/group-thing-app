import { useState } from "react";
import { Link } from "react-router-dom";
import { createTerm } from "../../api/terms";
import { Field, ModalSheet } from "../../pages/panel/PanelPage";

/* ------------------------------------------------------------------ */
/*  ORGANIZER "first term" stepper — 1 step (term only), for an          */
/*  ORGANIZER who already owns exactly one circle with zero terms.       */
/*  `circleGroupId` is pre-filled by the host from `myGroups[0].id`,     */
/*  so unlike the GUEST variant this component never needs a circle-     */
/*  name step or a `<select>` (scope-clarifications.md Decision #3 —     */
/*  a genuinely separate component, not a shared stepper with a          */
/*  skipped step).                                                       */
/* ------------------------------------------------------------------ */

const inputClass = "rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink";

interface FirstTermStepperOrganizerProps {
  onClose: () => void;
  circleGroupId: number | null;
  onDone: () => void;
}

export function FirstTermStepperOrganizer({ onClose, circleGroupId, onDone }: FirstTermStepperOrganizerProps) {
  const [occursOn, setOccursOn] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    if (!occursOn || !circleGroupId) return;
    setBusy(true);
    setFormError(null);
    try {
      await createTerm({ circle_group_id: circleGroupId, occurs_on: occursOn, description: description || undefined });
      setDone(true);
    } catch {
      setFormError("Nie udało się dodać terminu — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <ModalSheet title="Dodaj pierwszy termin" onClose={onDone}>
        <p className="text-[13.5px] text-ink-soft">
          Termin dodany! Możesz teraz zobaczyć, jak wygląda Twoja publiczna strona kręgu —
          tę stronę może zobaczyć każdy, kto dostanie do niej link, bez logowania.
        </p>
        <Link
          to={`/krag/${circleGroupId}/publiczny`}
          className="mt-4 block w-full rounded-[13px] bg-mint px-5 py-3 text-center text-[13.5px] font-extrabold text-white"
        >
          Przejdź do publicznej strony →
        </Link>
        <button
          type="button"
          onClick={onDone}
          className="mt-2 w-full rounded-[13px] border-[1.5px] border-line px-5 py-3 text-[13.5px] font-extrabold text-ink-soft"
        >
          Gotowe
        </button>
      </ModalSheet>
    );
  }

  return (
    <ModalSheet title="Dodaj pierwszy termin" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3">
        <Field label="Data">
          <input
            type="date"
            aria-label="Data"
            value={occursOn}
            onChange={(e) => setOccursOn(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Opis (opcjonalnie)">
          <input
            aria-label="Opis (opcjonalnie)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="17:00 · Park Sołacki · wstęp wolny"
            className={inputClass}
          />
        </Field>
      </div>
      {formError && <p className="mt-2 text-[12.5px] font-semibold text-danger">{formError}</p>}
      <button
        onClick={() => void handleSubmit()}
        disabled={busy || !occursOn || !circleGroupId}
        className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
      >
        Dodaj termin
      </button>
    </ModalSheet>
  );
}
