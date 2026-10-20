import type { GroupLayoutMode, GroupVisibility } from "../../api/groups";
import { Field } from "../../pages/panel/panelComponents";
import { LocationPicker, type FallbackLocation } from "../shared/LocationPicker";

const inputClass = "rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink";

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
  defaultCapacity: number | null;
}

interface GroupFormFieldsProps {
  value: GroupFormValue;
  onChange: (next: GroupFormValue) => void;
  /** "Szablon wizualizacji" — the edit form only. */
  showLayoutMode?: boolean;
  idPrefix: string;
  fallbackLocation?: FallbackLocation | null;
}

/** The group fields shared by the "Załóż grupę" stepper and the add/edit
 * group sheets, always in one order: name, (layout), visibility, place, capacity. */
export function GroupFormFields({ value, onChange, showLayoutMode = false, idPrefix, fallbackLocation }: GroupFormFieldsProps) {
  function set(patch: Partial<GroupFormValue>) {
    onChange({ ...value, ...patch });
  }

  function parseCapacity(raw: string): number | null {
    if (raw.trim() === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      <Field label="Nazwa grupy">
        <input
          aria-label="Nazwa grupy"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="np. Nutki dla starszaków"
          className={inputClass}
        />
      </Field>
      {showLayoutMode && (
        <Field label="Szablon wizualizacji">
          <select
            aria-label="Szablon wizualizacji"
            value={value.layoutMode ?? "CIRCLE"}
            onChange={(e) => set({ layoutMode: e.target.value as GroupLayoutMode })}
            className={inputClass}
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
          className={inputClass}
        >
          <option value="PUBLIC">Publiczna</option>
          <option value="PRIVATE">Prywatna — (dostęp na prośbę)</option>
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
      <Field label={CAPACITY_LABEL}>
        <input
          aria-label={CAPACITY_LABEL}
          type="number"
          min={1}
          inputMode="numeric"
          value={value.defaultCapacity ?? ""}
          onChange={(e) => set({ defaultCapacity: parseCapacity(e.target.value) })}
          placeholder="np. 12"
          className={`${inputClass} w-28`}
        />
      </Field>
    </div>
  );
}
