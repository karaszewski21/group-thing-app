import { useId } from "react";
import { Field, INPUT_CLASS } from "../../components/shared/appComponents";
import { approxAge, birthYearError, formatApproxAge } from "../../utils/age";

/** A child's optional birth year: the raw input text, an inline error while
 * it is invalid (the host blocks submit, see `birthYearError`) and the
 * approximate age once it is valid. */
export function BirthYearField({ value, onChange }: { value: string; onChange: (raw: string) => void }) {
  const errorId = useId();
  const error = birthYearError(value);
  return (
    <Field label="Rok urodzenia">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label="Rok urodzenia"
        aria-invalid={error !== null || undefined}
        aria-describedby={error ? errorId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="np. 2018"
        className={`${INPUT_CLASS} w-28`}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : (
        value.trim() && <p className="text-[12px] text-ink-soft">{formatApproxAge(approxAge(Number(value)))}</p>
      )}
    </Field>
  );
}
