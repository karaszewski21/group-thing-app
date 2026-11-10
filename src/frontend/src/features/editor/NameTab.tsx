import { SECTION_LABEL } from "./ColorsTab";

const MAX_NAME_LENGTH = 255;

interface NameTabProps {
  /** The field's label, e.g. "Nazwa organizacji" or "Imię i nazwisko". */
  label: string;
  hint: string;
  value: string;
  onChange: (name: string) => void;
}

/** The name shown at the top of the page. Blank is invalid: the error is
 * shown inline and the editor's "Zapisz" stays blocked. */
export function NameTab({ label, hint, value, onChange }: NameTabProps) {
  const invalid = value.trim() === "";
  return (
    <div className="flex flex-col gap-1.5 font-sans">
      <label htmlFor="editor-name" className={SECTION_LABEL}>
        {label}
      </label>
      <input
        id="editor-name"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={MAX_NAME_LENGTH}
        aria-invalid={invalid}
        aria-describedby={invalid ? "editor-name-error editor-name-hint" : "editor-name-hint"}
        className="min-h-11 w-full rounded-xl border-[1.5px] border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none focus-visible:border-focus-ring aria-invalid:border-danger disabled:opacity-50"
      />
      {invalid && (
        <p id="editor-name-error" role="alert" className="text-[12.5px] font-semibold text-danger">
          Podaj nazwę.
        </p>
      )}
      <p id="editor-name-hint" className="text-[12px] text-ink-soft">
        {hint}
      </p>
    </div>
  );
}
