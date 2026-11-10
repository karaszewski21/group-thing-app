import { useState } from "react";
import { Link } from "../../routing/navigation";
import type { LocationRefResponse } from "../../api/locations";
import { createTerm, type CreateTermRequest } from "../../api/terms";
import { serverMessageOr } from "../../api/problem";
import { CapacityField, Field, INPUT_CLASS, ModalSheet } from "../../components/shared/appComponents";
import { parseCapacity } from "../../utils/appHelpers";
import { LocationPicker } from "../../components/shared/LocationPicker";
import { FIRST_TERM_PICKER } from "./hooks/useFirstTermStepper";
import type { TermDraft } from "./termDraft";

/* ------------------------------------------------------------------ */
/*  ORGANIZER "first term" stepper — 1 step (term only), for an          */
/*  ORGANIZER who already owns exactly one circle with zero terms.       */
/*  `circleGroupId` is pre-filled by the host from `myGroups[0].id`,     */
/*  so unlike the GUEST variant this component never needs a circle-     */
/*  name step or a `<select>` (scope-clarifications.md Decision #3 —     */
/*  a genuinely separate component, not a shared stepper with a          */
/*  skipped step).                                                       */
/* ------------------------------------------------------------------ */

interface FirstTermStepperOrganizerProps {
  /** The form values, kept by the host (`firstTermDraft`) so a trip to
   * /places/new keeps them. */
  draft: TermDraft;
  onDraftChange: (draft: TermDraft) => void;
  /** ✕/Esc/backdrop — drops the draft. */
  onClose: () => void;
  /** The place picker's "+": closes the stepper for /places/new, keeping the draft. */
  onAddPlace: () => void;
  circleGroupId: string | null;
  /** The organizer's own Organization slug, or null when they have no
   * Organization yet — drives the done-screen CTA. */
  organizerSlug?: string | null;
  onDone: () => void;
  /** The group's default place and capacity, which the host's draft starts from. */
  defaultLocation?: LocationRefResponse | null;
  defaultCapacity?: number | null;
}

export function FirstTermStepperOrganizer({
  draft,
  onDraftChange,
  onClose,
  onAddPlace,
  circleGroupId,
  organizerSlug,
  onDone,
  defaultLocation = null,
  defaultCapacity = null,
}: FirstTermStepperOrganizerProps) {
  const { occursOn, description, locationId } = draft;
  const capacity = parseCapacity(draft.capacity);
  const set = (patch: Partial<TermDraft>) => onDraftChange({ ...draft, ...patch });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [createdTermId, setCreatedTermId] = useState<string | null>(null);

  async function handleSubmit() {
    if (!occursOn || !circleGroupId || !locationId || capacity === undefined) return;
    setBusy(true);
    setFormError(null);
    try {
      const request: CreateTermRequest = {
        group_id: circleGroupId,
        occurs_on: occursOn,
        description: description || undefined,
        location_id: locationId,
      };
      // An omitted capacity inherits the group default; a cleared prefill must be an explicit null.
      if (capacity !== null || defaultCapacity !== null) request.capacity = capacity;
      const created = await createTerm(request);
      setCreatedTermId(created.id);
      setDone(true);
    } catch (err) {
      setFormError(serverMessageOr(err, "Nie udało się dodać terminu — spróbuj ponownie"));
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
          to={`/${organizerSlug ?? "krag"}/group/${circleGroupId}/term/${createdTermId}`}
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
        <Field label="Data i godzina">
          <input
            type="datetime-local"
            aria-label="Data i godzina"
            value={occursOn}
            onChange={(e) => set({ occursOn: e.target.value })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Opis (opcjonalnie)">
          <input
            aria-label="Opis (opcjonalnie)"
            value={description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="17:00 · Park Sołacki · wstęp wolny"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Miejsce">
          <LocationPicker
            value={locationId}
            onChange={(id) => set({ locationId: id })}
            label="Miejsce"
            idPrefix={FIRST_TERM_PICKER}
            required
            onAddClick={onAddPlace}
            fallbackLocation={defaultLocation}
            helperText={defaultLocation ? "Domyślne miejsce grupy — możesz zmienić" : undefined}
          />
        </Field>
        <CapacityField label="Ile miejsc" value={draft.capacity} onChange={(text) => set({ capacity: text })} />
      </div>
      {formError && (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
          {formError}
        </p>
      )}
      <button
        onClick={() => void handleSubmit()}
        disabled={busy || !occursOn || !circleGroupId || !locationId || capacity === undefined}
        className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
      >
        Dodaj termin
      </button>
    </ModalSheet>
  );
}
