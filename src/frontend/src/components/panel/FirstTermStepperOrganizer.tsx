import { useState } from "react";
import { Link } from "react-router-dom";
import type { LocationRefResponse } from "../../api/locations";
import { createTerm, type CreateTermRequest } from "../../api/terms";
import { serverMessageOr } from "../../api/problem";
import { CapacityField, Field, INPUT_CLASS, ModalSheet } from "../shared/appComponents";
import { capacityText, parseCapacity } from "../../utils/appHelpers";
import { LocationPicker } from "../shared/LocationPicker";

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
  onClose: () => void;
  circleGroupId: string | null;
  /** The organizer's own Organization slug, or null when they have no
   * Organization yet — drives the done-screen CTA. */
  organizerSlug?: string | null;
  onDone: () => void;
  /** The group's default place and capacity, prefilled into the form. */
  defaultLocation?: LocationRefResponse | null;
  defaultCapacity?: number | null;
}

export function FirstTermStepperOrganizer({
  onClose,
  circleGroupId,
  organizerSlug,
  onDone,
  defaultLocation = null,
  defaultCapacity = null,
}: FirstTermStepperOrganizerProps) {
  const [occursOn, setOccursOn] = useState("");
  const [description, setDescription] = useState("");
  const [locationId, setLocationId] = useState<string | null>(defaultLocation?.id ?? null);
  const [capacityInput, setCapacityInput] = useState(capacityText(defaultCapacity));
  const capacity = parseCapacity(capacityInput);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [createdTermId, setCreatedTermId] = useState<string | null>(null);

  async function handleSubmit() {
    if (!occursOn || !circleGroupId || capacity === undefined) return;
    setBusy(true);
    setFormError(null);
    try {
      const request: CreateTermRequest = {
        circle_group_id: circleGroupId,
        occurs_on: occursOn,
        description: description || undefined,
      };
      // An omitted field inherits the group default; a cleared prefill must be an explicit null.
      if (locationId !== null || defaultLocation !== null) request.location_id = locationId;
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
          to={`/${organizerSlug ?? "krag"}/grupa/${circleGroupId}/term/${createdTermId}`}
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
            idPrefix="first-term-place"
            fallbackLocation={defaultLocation}
            helperText={defaultLocation ? "Domyślne miejsce grupy — możesz zmienić" : undefined}
          />
        </Field>
        <CapacityField label="Ile miejsc" value={capacityInput} onChange={setCapacityInput} />
      </div>
      {formError && (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold text-danger">
          {formError}
        </p>
      )}
      <button
        onClick={() => void handleSubmit()}
        disabled={busy || !occursOn || !circleGroupId || capacity === undefined}
        className="mt-4 w-full rounded-[13px] bg-mint px-5 py-3 text-[13.5px] font-extrabold text-white disabled:opacity-60"
      >
        Dodaj termin
      </button>
    </ModalSheet>
  );
}
