import { useState } from "react";
import { parsePointsPrice, pointsPriceError, type PointsPriceBounds } from "../../utils/appHelpers";

interface PointsPriceStepperProps {
  /** The input's id; the range line and the error take `${id}-range` / `${id}-error`. */
  id: string;
  /** The raw input text, kept as typed. */
  value: string;
  onChange: (value: string) => void;
  bounds: PointsPriceBounds;
  /** The system's suggested price, shown beside the range and used as the
   * starting point of −/+ when the text is not a number. */
  suggestion: number;
  disabled?: boolean;
}

const STEP_BUTTON =
  "h-12 w-12 shrink-0 rounded-xl border border-line-strong bg-paper text-[22px] font-extrabold text-ink disabled:opacity-40";

/** The POINTS price field: −/+ by `bounds.step` within the bounds around a
 * numeric text input; an off-bounds or off-step value shows the server's
 * message inline (`aria-invalid` and described at once, announced as an
 * alert only after the user changed the value, never on mount). The owner
 * blocks submit on `parsePointsPrice` itself. */
export function PointsPriceStepper({ id, value, onChange, bounds, suggestion, disabled }: PointsPriceStepperProps) {
  const { min, max, step } = bounds;
  const [edited, setEdited] = useState(false);
  function change(next: string) {
    setEdited(true);
    onChange(next);
  }
  const invalid = typeof parsePointsPrice(value, bounds) !== "number";
  const rangeId = `${id}-range`;
  const errorId = `${id}-error`;
  const typed = value.trim();
  const base = /^\d+$/.test(typed) ? Number(typed) : suggestion;
  const lower = Math.min(max, Math.max(min, Math.ceil(base / step) * step - step));
  const higher = Math.max(min, Math.min(max, Math.floor(base / step) * step + step));

  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-bold text-ink">
        Cena w punktach
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          aria-label={`Obniż o ${step}`}
          disabled={disabled || base <= min}
          onClick={() => change(String(lower))}
          className={STEP_BUTTON}
        >
          −
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          disabled={disabled}
          onChange={(e) => change(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${rangeId} ${errorId}` : rangeId}
          className="h-12 min-w-0 flex-1 rounded-xl border border-line-strong bg-paper text-center text-xl font-extrabold text-ink aria-invalid:border-danger aria-invalid:bg-danger-soft"
        />
        <span aria-hidden="true" className="font-extrabold text-ink-soft">
          pkt
        </span>
        <button
          type="button"
          aria-label={`Podnieś o ${step}`}
          disabled={disabled || base >= max}
          onClick={() => change(String(higher))}
          className={STEP_BUTTON}
        >
          +
        </button>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-[12.5px]">
        <span>
          System proponuje <b className="font-extrabold text-mint">{suggestion} pkt</b>
        </span>
        <span id={rangeId} className="text-ink-soft">
          Dozwolone {min}–{max} pkt, co {step}
        </span>
      </div>
      {/* Re-inserted as an alert on the first edit, so it is announced then. */}
      {invalid && (
        <p
          key={edited ? "alert" : "note"}
          id={errorId}
          role={edited ? "alert" : undefined}
          className="mt-1.5 text-[12.5px] font-bold text-danger"
        >
          {pointsPriceError(bounds)}
        </p>
      )}
    </div>
  );
}
