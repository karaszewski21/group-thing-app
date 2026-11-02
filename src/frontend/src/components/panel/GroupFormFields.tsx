import type { GroupLayoutMode, GroupVisibility } from "../../api/groups";
import { CapacityField, Field, INPUT_CLASS } from "../shared/appComponents";
import { LocationPicker, type FallbackLocation } from "../shared/LocationPicker";

const LAYOUT_OPTIONS: { mode: GroupLayoutMode; label: string }[] = [
  { mode: "CIRCLE", label: "Koło" },
  { mode: "PITCH", label: "Boisko" },
  { mode: "TABLE", label: "Stół" },
];

const PLACE_LABEL = "Stałe miejsce spotkań (opcjonalnie)";
const CAPACITY_LABEL = "Ile miejsc (opcjonalnie)";

export interface GroupFormValue {
  name: string;
  visibility: GroupVisibility;
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
 * order: name, (layout), visibility, place, capacity. */
export function GroupFormFields({ value, onChange, showLayoutMode = false, idPrefix, fallbackLocation }: GroupFormFieldsProps) {
  function set(patch: Partial<GroupFormValue>) {
    onChange({ ...value, ...patch });
  }

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
