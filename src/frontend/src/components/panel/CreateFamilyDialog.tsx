import { useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { createLightweightMembers, createOwnFamily, type FamilyOut } from "../../api/families";
import { Field, ModalSheet } from "../../pages/panel/PanelPage";

/* ------------------------------------------------------------------ */
/*  "Załóż rodzinę" — 2-step Panel dialog (family name -> optional     */
/*  members), mirroring FirstTermStepperGuest.tsx: local `useState`    */
/*  for cross-step data (deliberately not module scope — the modal can */
/*  be opened/closed/reopened in one page session), ModalSheet/Field   */
/*  primitives from PanelPage, inline error on catch. The host wires   */
/*  `onCreated` to a `load({ silent: true })` refresh so the open      */
/*  modal is never unmounted mid-flow.                                 */
/* ------------------------------------------------------------------ */

const inputClass = "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink";

interface MemberDraft {
  /** Stable UI-only id (monotonic counter) so the list keys on identity, not
   * array index — removing a member mid-list must not shift inputs/state onto
   * the wrong row. Dropped on submit (`createLightweightMembers` takes only
   * `{name, role_type}`). */
  id: number;
  name: string;
  roleType: "GUARDIAN" | "CHILD";
}

interface CreateFamilyDialogProps {
  onClose: () => void;
  /** Fired once the flow finishes ("done" screen) — host closes the
   * modal, toasts, and runs `load({ silent: true })`. */
  onCreated: () => void;
}

export function CreateFamilyDialog({ onClose, onCreated }: CreateFamilyDialogProps) {
  const [step, setStep] = useState<1 | 2 | "done">(1);
  const [familyName, setFamilyName] = useState("");
  const [family, setFamily] = useState<FamilyOut | null>(null);
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] = useState<"GUARDIAN" | "CHILD">("GUARDIAN");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const nextMemberId = useRef(0);

  async function handleStep1() {
    if (!familyName.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      const created = await createOwnFamily(familyName.trim());
      setFamily(created);
      setStep(2);
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.status === 400
          ? "Podaj poprawną nazwę rodziny (1–255 znaków)"
          : "Nie udało się założyć rodziny — spróbuj ponownie",
      );
    } finally {
      setBusy(false);
    }
  }

  function addDraftMember() {
    if (!draftName.trim()) return;
    setMembers((prev) => [
      ...prev,
      { id: nextMemberId.current++, name: draftName.trim(), roleType: draftRole },
    ]);
    setDraftName("");
    setDraftRole("GUARDIAN");
  }

  function removeDraftMember(id: number) {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }

  async function handleStep2() {
    setBusy(true);
    setFormError(null);
    try {
      if (members.length > 0) {
        await createLightweightMembers(
          members.map((m) => ({ name: m.name, role_type: m.roleType })),
        );
      }
      setStep("done");
    } catch {
      setFormError("Nie udało się dodać członków — spróbuj ponownie");
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    onClose();
    onCreated();
  }

  if (step === "done") {
    return (
      <ModalSheet title="Załóż rodzinę" onClose={finish}>
        <p className="text-[13.5px] text-ink-soft">
          Gotowe — rodzina {family?.name ?? ""} została założona.
        </p>
        <button
          type="button"
          onClick={finish}
          className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white"
        >
          Gotowe
        </button>
      </ModalSheet>
    );
  }

  return (
    <ModalSheet title="Załóż rodzinę" onClose={onClose}>
      <div className="mb-4 flex items-center justify-center gap-1.5" aria-hidden="true">
        <span className={`h-1.5 w-1.5 rounded-full ${step === 1 ? "bg-mint" : "bg-line"}`} />
        <span className={`h-1.5 w-1.5 rounded-full ${step === 2 ? "bg-mint" : "bg-line"}`} />
      </div>

      {step === 1 ? (
        <>
          <Field label="Nazwa rodziny">
            <input
              aria-label="Nazwa rodziny"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="np. Kowalscy"
              className={inputClass}
            />
          </Field>
          {formError && <p className="mt-2 text-[12.5px] font-semibold text-danger">{formError}</p>}
          <button
            onClick={() => void handleStep1()}
            disabled={busy || !familyName.trim()}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Dalej
          </button>
        </>
      ) : (
        <>
          <h4 className="mb-3 text-sm font-semibold text-ink">Dodaj członków (opcjonalnie)</h4>

          {members.length > 0 && (
            <ul className="mb-3 flex flex-col gap-1.5">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-xl border border-line bg-cream px-3 py-2 text-[13px]"
                >
                  <span className="flex-1 text-ink">{m.name}</span>
                  <span className="text-ink-soft">
                    {m.roleType === "GUARDIAN" ? "Opiekun" : "Dziecko"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDraftMember(m.id)}
                    className="text-xs font-bold text-danger"
                  >
                    Usuń
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-1 gap-3">
            <Field label="Imię i nazwisko">
              <input
                aria-label="Imię i nazwisko"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="np. Zosia Kowalska"
                className={inputClass}
              />
            </Field>
            <Field label="Rola">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDraftRole("GUARDIAN")}
                  aria-pressed={draftRole === "GUARDIAN"}
                  className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
                    draftRole === "GUARDIAN"
                      ? "border-mint bg-mint-soft text-mint"
                      : "border-line bg-cream text-ink-soft"
                  }`}
                >
                  Opiekun
                </button>
                <button
                  type="button"
                  onClick={() => setDraftRole("CHILD")}
                  aria-pressed={draftRole === "CHILD"}
                  className={`flex-1 rounded-xl border-[1.5px] px-3 py-2.5 text-sm font-bold transition ${
                    draftRole === "CHILD"
                      ? "border-mint bg-mint-soft text-mint"
                      : "border-line bg-cream text-ink-soft"
                  }`}
                >
                  Dziecko
                </button>
              </div>
            </Field>
          </div>

          <button
            type="button"
            onClick={addDraftMember}
            disabled={!draftName.trim()}
            className="mt-3 w-full rounded-[13px] border-[1.5px] border-line px-5 py-2.5 text-[13px] font-extrabold text-ink-soft disabled:opacity-60"
          >
            Dodaj kolejną osobę
          </button>

          {formError && <p className="mt-2 text-[12.5px] font-semibold text-danger">{formError}</p>}

          <button
            onClick={() => void handleStep2()}
            disabled={busy}
            className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            Zakończ
          </button>
        </>
      )}
    </ModalSheet>
  );
}
