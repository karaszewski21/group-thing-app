import type { GroupLayoutMode, GroupVisibility } from "../../api/groups";
import { CapacityField, Field, INPUT_CLASS } from "../../components/shared/appComponents";
import { LocationPicker, type FallbackLocation } from "../../components/shared/LocationPicker";

const LAYOUT_OPTIONS: { mode: GroupLayoutMode; label: string }[] = [
  { mode: "CIRCLE", label: "Koło" },
  { mode: "PITCH", label: "Boisko" },
  { mode: "TABLE", label: "Stół" },
];

const DESCRIPTION_MAX = 500;
const DESCRIPTION_HINT = "Widoczny na stronie terminów grupy i w wyszukiwarce. Bez linków i danych kontaktowych.";
const DESCRIPTION_ERROR = `Opis może mieć najwyżej ${DESCRIPTION_MAX} znaków.`;

/** Code points after trim, as the server counts them (an emoji is one). */
function descriptionLength(description: string): number {
  return [...description.trim()].length;
}

// eslint-disable-next-line react-refresh/only-export-components -- the hosts and AppDataContext share the form's own rule
export function isDescriptionTooLong(description: string): boolean {
  return descriptionLength(description) > DESCRIPTION_MAX;
}

/** The request value: trimmed, a blank description is `null`. */
// eslint-disable-next-line react-refresh/only-export-components -- the hosts and AppDataContext share the form's own rule
export function descriptionRequestValue(description: string): string | null {
  return description.trim() || null;
}

const PLACE_LABEL = "Stałe miejsce spotkań (opcjonalnie)";
const CAPACITY_LABEL = "Ile miejsc (opcjonalnie)";

export interface GroupFormValue {
  name: string;
  visibility: GroupVisibility;
  /** Raw textarea text; `descriptionRequestValue` turns it into the request value. */
  description: string;
  layoutMode?: GroupLayoutMode;
  defaultLocationId: string | null;
  /** Raw input text; `parseCapacity` turns it into the request value. */
  defaultCapacity: string;
}

interface GroupFormFieldsProps {
  value: GroupFormValue;
  onChange: (next: GroupFormValue) => void;
  /** "Szablon wizualizacji" — the edit form only. */
  showLayoutMode?: boolean;
  idPrefix: string;
  fallbackLocation?: FallbackLocation | null;
}

/** The group fields shared by the add and edit group pages, always in one
 * order: name, description, (layout), visibility, place, capacity. */
export function GroupFormFields({ value, onChange, showLayoutMode = false, idPrefix, fallbackLocation }: GroupFormFieldsProps) {
  function set(patch: Partial<GroupFormValue>) {
    onChange({ ...value, ...patch });
  }
  const descriptionId = `${idPrefix}-description`;
  const countId = `${descriptionId}-count`;
  const hintId = `${descriptionId}-hint`;
  const errorId = `${descriptionId}-error`;
  const descriptionInvalid = isDescriptionTooLong(value.description);

  return (
    <div className="grid grid-cols-1 gap-3">
      <Field label="Nazwa grupy">
        <input
          aria-label="Nazwa grupy"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="np. Nutki dla starszaków"
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="Opis" htmlFor={descriptionId}>
        <textarea
          id={descriptionId}
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={4}
          aria-invalid={descriptionInvalid || undefined}
          aria-describedby={descriptionInvalid ? `${countId} ${errorId}` : `${countId} ${hintId}`}
          className={`${INPUT_CLASS} resize-y aria-[invalid=true]:border-danger`}
        />
        <p id={countId} className={`text-right text-[12px] ${descriptionInvalid ? "font-extrabold text-danger" : "text-ink-soft"}`}>
          {descriptionLength(value.description)} / {DESCRIPTION_MAX}
        </p>
        {descriptionInvalid ? (
          <p id={errorId} role="alert" className="text-[12.5px] font-semibold text-danger">
            {DESCRIPTION_ERROR}
          </p>
        ) : (
          <p id={hintId} className="text-[12.5px] text-ink-soft">
            {DESCRIPTION_HINT}
          </p>
        )}
      </Field>
      {showLayoutMode && (
        <Field label="Szablon wizualizacji">
          <select
            aria-label="Szablon wizualizacji"
            value={value.layoutMode ?? "CIRCLE"}
            onChange={(e) => set({ layoutMode: e.target.value as GroupLayoutMode })}
            className={INPUT_CLASS}
          >
            {LAYOUT_OPTIONS.map(({ mode, label }) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Widoczność grupy">
        <select
          aria-label="Widoczność grupy"
          value={value.visibility}
          onChange={(e) => set({ visibility: e.target.value as GroupVisibility })}
          className={INPUT_CLASS}
        >
          <option value="PUBLIC">Publiczna</option>
          <option value="PRIVATE">Prywatna — (dostęp z kodem)</option>
        </select>
      </Field>
      <Field label={PLACE_LABEL}>
        <LocationPicker
          value={value.defaultLocationId}
          onChange={(defaultLocationId) => set({ defaultLocationId })}
          label={PLACE_LABEL}
          noneLabel="Brak stałego miejsca"
          idPrefix={`${idPrefix}-place`}
          fallbackLocation={fallbackLocation}
        />
      </Field>
      <CapacityField
        label={CAPACITY_LABEL}
        value={value.defaultCapacity}
        onChange={(defaultCapacity) => set({ defaultCapacity })}
      />
    </div>
  );
}
