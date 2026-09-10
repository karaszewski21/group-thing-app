import { useState } from "react";
import { Link } from "react-router-dom";
import { createMyCircle, type GroupResponse } from "../../api/groups";
import { createTerm } from "../../api/terms";
import { Field, ModalSheet } from "../../pages/panel/panelComponents";

/* ------------------------------------------------------------------ */
/*  GUEST "first term" stepper — 2 steps (circle name -> term date/     */
/*  description), reusing PanelPage's ModalSheet/Field primitives and   */
/*  the createMyCircle/createTerm service calls already used by the     */
/*  onboarding wizard's CircleNameStepBody/TermStepBody (see             */
/*  organizerSteps.tsx), ported outside the wizard shell as a plain      */
/*  modal component. Cross-step state (the created circle) is local     */
/*  `useState`, deliberately NOT a module-scoped variable like            */
/*  organizerSteps.tsx's `createdCircle` — this modal can be opened/     */
/*  closed/reopened many times in one page session without a reload,     */
/*  where a module-scoped variable would leak stale state across         */
/*  re-opens (spec.md §2).                                               */
/* ------------------------------------------------------------------ */

const inputClass = "rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink";

interface FirstTermStepperGuestProps {
  onClose: () => void;
  /** Fired immediately after step 1 (circle creation) succeeds, so the
   * host can refresh `myGroups`/`isOrganizer` without waiting for the
   * full flow to complete. */
  onCircleCreated: () => void;
  /** Fired after step 2 (term creation) succeeds — host closes the
   * modal, toasts, and reloads. */
  onDone: () => void;
}

export function FirstTermStepperGuest({ onClose, onCircleCreated, onDone }: FirstTermStepperGuestProps) {
  const [step, setStep] = useState<1 | 2 | "done">(1);
  const [circleName, setCircleName] = useState("");
  const [circle, setCircle] = useState<GroupResponse | null>(null);
  const [occursOn, setOccursOn] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdTermId, setCreatedTermId] = useState<number | null>(null);

  async function handleStep1() {
    if (!circleName.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      const created = await createMyCircle({ name: circleName.trim() });
      setCircle(created);
      setStep(2);
      onCircleCreated();
    } catch {
      setFormError("Nie udało się utworzyć kręgu — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  async function handleStep2() {
    if (!occursOn || !circle) return;
    setBusy(true);
    setFormError(null);
    try {
      const created = await createTerm({ circle_group_id: circle.id, occurs_on: occursOn, description: description || undefined });
      setCreatedTermId(created.id);
      onCircleCreated(); // refresh host state (terms.length) now, not just on close
      setStep("done");
    } catch {
      setFormError("Nie udało się dodać terminu — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done" && circle) {
    return (
      <ModalSheet title="Dodaj pierwszy termin" onClose={onDone}>
        <p className="text-[13.5px] text-ink-soft">
          Termin dodany! Możesz teraz zobaczyć, jak wygląda Twoja publiczna strona kręgu —
          tę stronę może zobaczyć każdy, kto dostanie do niej link, bez logowania.
        </p>
        <Link
          to={`/${circle.organizer_slug ?? "krag"}/grupa/${circle.id}/term/${createdTermId}`}
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
      <div className="mb-4 flex items-center justify-center gap-1.5" aria-hidden="true">
        <span className={`h-1.5 w-1.5 rounded-full ${step === 1 ? "bg-mint" : "bg-line"}`} />
        <span className={`h-1.5 w-1.5 rounded-full ${step === 2 ? "bg-mint" : "bg-line"}`} />
      </div>

      {step === 1 ? (
        <>
          <div className="grid grid-cols-1 gap-3">
            <Field label="Nazwa kręgu">
              <input
                value={circleName}
                onChange={(e) => setCircleName(e.target.value)}
                placeholder="np. Nutki dla starszaków"
                className={inputClass}
              />
            </Field>
          </div>
          {formError && <p className="mt-2 text-[12.5px] font-semibold text-danger">{formError}</p>}
          <button
            onClick={() => void handleStep1()}
            disabled={busy || !circleName.trim()}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Dalej →
          </button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3">
            <Field label="Data i godzina">
              <input
                type="datetime-local"
                aria-label="Data i godzina"
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
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={busy}
              className="flex-none rounded-[13px] border-[1.5px] border-line px-5 py-3 text-[13.5px] font-extrabold text-ink-soft disabled:opacity-60"
            >
              ← Wstecz
            </button>
            <button
              onClick={() => void handleStep2()}
              disabled={busy || !occursOn}
              className="flex-1 rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
            >
              Dodaj
            </button>
          </div>
        </>
      )}
    </ModalSheet>
  );
}
