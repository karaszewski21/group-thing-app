import { useId, useState } from "react";

const SAVE_FAILED = "Nie udało się zapisać zmiany.";

/** The notification switch of one want. A change shows at once and is saved
 * by `onChange`; when that rejects, the switch goes back and the message is
 * shown below the row. */
export function WantNotificationToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => Promise<void>;
}) {
  const labelId = useId();
  const hintId = useId();
  const [saving, setSaving] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = saving ?? checked;

  async function toggle() {
    if (saving !== null) return;
    const next = !checked;
    setSaving(next);
    setError(null);
    try {
      await onChange(next);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : SAVE_FAILED);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mb-3">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <strong id={labelId} className="block text-[15px] text-ink">
            Powiadomienia o nowych rzeczach
          </strong>
          <p id={hintId} className="text-[13px] text-ink-soft">
            {shown ? "Damy znać w dzwonku" : "Wyłączone"}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={shown}
          aria-labelledby={labelId}
          aria-describedby={hintId}
          onClick={() => void toggle()}
          className={`relative h-7 w-[46px] flex-none rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${shown ? "bg-primary" : "bg-line-strong"}`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-[3px] left-[3px] h-[22px] w-[22px] rounded-full bg-paper shadow transition-transform ${shown ? "translate-x-[18px]" : ""}`}
          />
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
