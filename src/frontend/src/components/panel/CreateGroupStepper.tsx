import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createAdditionalMyCircle, updateGroup, type GroupResponse } from "../../api/groups";
import { serverMessageOr } from "../../api/problem";
import { createTerm } from "../../api/terms";
import { CapacityField, Field, INPUT_CLASS, ModalSheet } from "../../pages/panel/panelComponents";
import { capacityText, defaultVisibility, parseCapacity, termPublicPath } from "../../pages/panel/panelHelpers";
import { LocationPicker } from "../shared/LocationPicker";
import { GroupFormFields, type GroupFormValue } from "./GroupFormFields";

/* ------------------------------------------------------------------ */
/*  "Załóż grupę" — 2 steps (group -> first term) for any logged-in     */
/*  user. Cross-step state (the created group) is local `useState`:     */
/*  the sheet is opened/closed many times in one page session, and a    */
/*  module-scoped variable would leak a stale group across re-opens.    */
/* ------------------------------------------------------------------ */

const TITLE = "Załóż grupę";
const errorClass = "mt-2 text-[12.5px] font-semibold text-danger";
const primaryClass =
  "rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60";
const secondaryClass =
  "rounded-[13px] border-[1.5px] border-line px-5 py-3 text-[13.5px] font-extrabold text-ink-soft disabled:opacity-60";

interface CreateGroupStepperProps {
  /** The caller's Organization slug, or null without one: sets the default
   * visibility and whether the done screen offers to create one. */
  organizationSlug: string | null;
  onClose: () => void;
  /** Fired after step 1 saves the group, so the host can refresh `myGroups`
   * without waiting for the whole flow. */
  onCircleCreated: () => void;
  /** Fired when the user leaves the done screen. */
  onDone: () => void;
}

function sameGroupFields(a: GroupFormValue, b: GroupFormValue): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.visibility === b.visibility &&
    a.defaultLocationId === b.defaultLocationId &&
    a.defaultCapacity === b.defaultCapacity
  );
}

export function CreateGroupStepper({ organizationSlug, onClose, onCircleCreated, onDone }: CreateGroupStepperProps) {
  const [step, setStep] = useState<1 | 2 | "done">(1);
  const [form, setForm] = useState<GroupFormValue>({
    name: "",
    visibility: defaultVisibility(organizationSlug),
    defaultLocationId: null,
    defaultCapacity: "",
  });
  const [group, setGroup] = useState<GroupResponse | null>(null);
  // The step-1 values `group` was last saved with — a return to step 1 saves again only when they changed.
  const [savedForm, setSavedForm] = useState<GroupFormValue | null>(null);
  const [occursOn, setOccursOn] = useState("");
  const [description, setDescription] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdTermId, setCreatedTermId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shownStep = useRef(step);
  const groupCapacity = parseCapacity(form.defaultCapacity);
  const termCapacity = parseCapacity(capacity);

  // The button that changed the step unmounts with it; move focus to the new
  // step's first field (or the done message) so it stays inside the sheet.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    bodyRef.current?.querySelector<HTMLElement>("input, [tabindex='-1']")?.focus();
  }, [step]);

  async function handleStep1() {
    const name = form.name.trim();
    if (!name || groupCapacity === undefined) return;
    if (group && savedForm && sameGroupFields(form, savedForm)) {
      setStep(2);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const request = {
        name,
        visibility: form.visibility,
        default_location_id: form.defaultLocationId,
        default_capacity: groupCapacity,
      };
      const saved = group ? await updateGroup(group.id, request) : await createAdditionalMyCircle(request);
      setGroup(saved);
      setSavedForm(form);
      setLocationId(saved.default_location?.id ?? null);
      setCapacity(capacityText(saved.default_capacity));
      setStep(2);
      onCircleCreated();
    } catch (err) {
      setFormError(serverMessageOr(err, "Nie udało się zapisać grupy — spróbuj ponownie"));
    } finally {
      setBusy(false);
    }
  }

  async function handleStep2() {
    if (!occursOn || !group || termCapacity === undefined) return;
    setBusy(true);
    setFormError(null);
    try {
      const created = await createTerm({
        circle_group_id: group.id,
        occurs_on: occursOn,
        description: description || undefined,
        location_id: locationId,
        capacity: termCapacity,
      });
      setCreatedTermId(created.id);
      onCircleCreated(); // refresh host state (terms.length) now, not just on close
      setStep("done");
    } catch (err) {
      setFormError(serverMessageOr(err, "Nie udało się dodać terminu — spróbuj ponownie"));
    } finally {
      setBusy(false);
    }
  }

  const errorAlert = formError && (
    <p role="alert" className={errorClass}>
      {formError}
    </p>
  );

  if (step === "done" && group && createdTermId) {
    return (
      <ModalSheet title={TITLE} onClose={onDone}>
        <div ref={bodyRef}>
          <p tabIndex={-1} className="text-[13.5px] text-ink-soft outline-none">
            Grupa założona, termin dodany! Tę stronę zobaczy każdy, kto dostanie link — bez logowania.
          </p>
          <Link to={termPublicPath(group, createdTermId)} className={`mt-4 block w-full text-center ${primaryClass}`}>
            Przejdź do publicznej strony →
          </Link>
          <button type="button" onClick={onDone} className={`mt-2 w-full ${secondaryClass}`}>
            Gotowe
          </button>
          {organizationSlug === null && (
            <div className="mt-4 rounded-2xl bg-accent-soft p-3.5">
              <p className="text-sm text-ink">
                Chcesz publiczną wizytówkę i własny adres strony? Możesz ją stworzyć kiedy chcesz.
              </p>
              <Link
                to="/organization"
                onClick={onDone}
                className="mt-2 inline-block text-sm font-extrabold text-accent-fg hover:underline"
              >
                Stwórz publiczną wizytówkę / własny adres →
              </Link>
            </div>
          )}
        </div>
      </ModalSheet>
    );
  }

  return (
    <ModalSheet title={TITLE} onClose={onClose}>
      <div ref={bodyRef}>
        <div className="mb-4 flex items-center justify-center gap-1.5" aria-hidden="true">
          {[1, 2].map((s) => (
            <span key={s} className={`h-1.5 w-1.5 rounded-full ${step === s ? "bg-mint" : "bg-line"}`} />
          ))}
        </div>

        {step === 1 ? (
          <>
            <GroupFormFields value={form} onChange={setForm} idPrefix="create-group" />
            {errorAlert}
            <button
              onClick={() => void handleStep1()}
              disabled={busy || !form.name.trim() || groupCapacity === undefined}
              className={`mt-4 w-full ${primaryClass}`}
            >
              Dalej →
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-[13.5px] text-ink-soft">Pierwszy termin w grupie „{group?.name}”</p>
            <div className="grid grid-cols-1 gap-3">
              <Field label="Data i godzina">
                <input
                  type="datetime-local"
                  aria-label="Data i godzina"
                  value={occursOn}
                  onChange={(e) => setOccursOn(e.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Opis (opcjonalnie)">
                <input
                  aria-label="Opis (opcjonalnie)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="17:00 · Park Sołacki · wstęp wolny"
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Miejsce">
                <LocationPicker
                  value={locationId}
                  onChange={setLocationId}
                  label="Miejsce"
                  noneLabel="Brak miejsca"
                  idPrefix="create-group-term-place"
                  fallbackLocation={group?.default_location ?? null}
                  helperText={group?.default_location ? "Domyślne miejsce grupy — możesz zmienić" : undefined}
                />
              </Field>
              <CapacityField label="Ile miejsc" value={capacity} onChange={setCapacity} />
            </div>
            {errorAlert}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setStep(1)} disabled={busy} className={`flex-none ${secondaryClass}`}>
                ← Wstecz
              </button>
              <button
                onClick={() => void handleStep2()}
                disabled={busy || !occursOn || termCapacity === undefined}
                className={`flex-1 ${primaryClass}`}
              >
                Dodaj
              </button>
            </div>
          </>
        )}
      </div>
    </ModalSheet>
  );
}
