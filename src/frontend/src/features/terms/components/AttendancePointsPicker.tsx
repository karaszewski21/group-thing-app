import { useId } from "react";
import { pluralPl } from "../../../utils/plural";

interface AttendancePointsPickerProps {
  /** The config's allowed levels. */
  allowedLevels: number[];
  /** The term's saved level; offered too when it is no longer allowed. */
  currentLevel?: number | null;
  value: number | null;
  onChange: (level: number) => void;
  minPresent: number;
  /** Set once the attendance is closed: the level can no longer change. */
  closed?: boolean;
}

/** „Punkty za obecność” of the term forms: one toggle button per level,
 * ascending, the chosen one `aria-pressed`. */
export function AttendancePointsPicker({
  allowedLevels,
  currentLevel = null,
  value,
  onChange,
  minPresent,
  closed = false,
}: AttendancePointsPickerProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  const levels = [...new Set(currentLevel === null ? allowedLevels : [...allowedLevels, currentLevel])].sort(
    (a, b) => a - b,
  );

  return (
    <div>
      <span id={labelId} className="block text-[13px] font-bold text-ink">
        Punkty za obecność
      </span>
      <div role="group" aria-labelledby={labelId} aria-describedby={helpId} className="mt-2 flex gap-2">
        {levels.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={level === value}
            disabled={closed}
            onClick={() => onChange(level)}
            className="min-h-[44px] flex-1 rounded-xl border border-line-strong bg-paper text-sm font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60 aria-pressed:border-mint aria-pressed:bg-mint aria-pressed:text-white"
          >
            {level}
          </button>
        ))}
      </div>
      <p id={helpId} className="mt-2 text-[12.5px] text-ink-soft">
        {closed
          ? "Obecność jest już zatwierdzona — nie można zmienić punktów za obecność."
          : `Każda obecna osoba dostanie tyle punktów, jeśli przyjdą co najmniej ${minPresent} ${pluralPl(minPresent, "osoba", "osoby", "osób")}. Możesz zmienić wybór do zatwierdzenia obecności.`}
      </p>
    </div>
  );
}
