import { useState } from "react";
import { ToggleRow } from "../../components/shared/appComponents";

const SAVE_FAILED = "Nie udało się zapisać zmiany. Spróbuj ponownie.";

/** One mail switch on `/settings`. A change shows at once and is saved by
 * `onSave`; when that rejects, the switch goes back and the message (the
 * server's Polish copy, else a fallback) is shown below the row. */
export function EmailCategoryToggle({
  label,
  hint,
  checked,
  disabled,
  onSave,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onSave: (enabled: boolean) => Promise<unknown>;
}) {
  const [saving, setSaving] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (disabled || saving !== null) return;
    const next = !checked;
    setSaving(next);
    setError(null);
    try {
      await onSave(next);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : SAVE_FAILED);
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <ToggleRow
        label={label}
        hint={hint}
        checked={saving ?? checked}
        disabled={disabled}
        onChange={() => void toggle()}
      />
      {error && (
        <p role="alert" className="mb-3 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
