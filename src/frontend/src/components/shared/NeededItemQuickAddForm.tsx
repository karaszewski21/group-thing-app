import type { NeededItemQuickAddValue } from "../../utils/neededItemQuickAdd";

const inputClass =
  "min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink";
const labelClass = "text-xs font-extrabold tracking-wide text-ink-soft";

interface NeededItemQuickAddFormProps {
  value: NeededItemQuickAddValue;
  onChange: (value: NeededItemQuickAddValue) => void;
  disabled?: boolean;
}

/**
 * "What do we need for this class" form — Nazwa (plain needed-item name) /
 * Doprecyzowanie (optional free-text refinement). Purely presentational;
 * callers own submission (`createNeededItem`).
 */
export function NeededItemQuickAddForm({
  value,
  onChange,
  disabled = false,
}: NeededItemQuickAddFormProps) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Nazwa">
        <input
          className={inputClass}
          placeholder="np. Termos"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          disabled={disabled}
        />
      </Field>

      <Field label="Doprecyzowanie (opcjonalnie)">
        <input
          className={inputClass}
          placeholder="np. rozmiar 1/2"
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}
