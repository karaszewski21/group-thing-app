import { useEffect, useRef, type ChangeEvent, type FocusEvent, type KeyboardEvent } from "react";

const CELL =
  "h-12 w-full min-w-0 rounded-xl border-[1.5px] bg-cream text-center font-mono text-xl font-semibold text-ink focus:border-focus-ring focus:shadow-[0_0_0_3px_var(--color-primary-soft)] focus:outline-none";

/**
 * A fixed-length numeric code as one box per digit. `digits` holds one
 * character per box (`""` when empty). Typing moves to the next box and
 * Backspace on an empty box to the previous one; a pasted or autofilled code
 * (`482 913`, `482-913`, an SMS one-time code) is spread over the boxes from
 * the focused one, ignoring anything but digits. `onBlur` fires only when
 * focus leaves the whole group, not when it moves between boxes.
 */
export function CodeDigitsInput({
  label,
  digits,
  onChange,
  onBlur,
  invalid,
  describedBy,
}: {
  label: string;
  digits: string[];
  onChange: (digits: string[]) => void;
  onBlur: () => void;
  invalid: boolean;
  describedBy: string;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const initialDigits = useRef(digits);

  useEffect(() => {
    const initial = initialDigits.current;
    const firstEmpty = initial.findIndex((d) => d === "");
    boxes.current[firstEmpty === -1 ? initial.length - 1 : firstEmpty]?.focus();
  }, []);

  function focusBox(index: number) {
    const box = boxes.current[Math.max(0, Math.min(index, digits.length - 1))];
    box?.focus();
    box?.select();
  }

  function handleChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const typed = event.target.value.replace(/\D/g, "");
    const next = [...digits];
    if (typed.length <= 1) {
      next[index] = typed;
      onChange(next);
      if (typed) focusBox(index + 1);
      return;
    }
    const spread = typed.slice(0, digits.length - index).split("");
    spread.forEach((d, k) => (next[index + k] = d));
    onChange(next);
    focusBox(index + spread.length);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && digits[index] === "" && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = "";
      onChange(next);
      focusBox(index - 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight" && index < digits.length - 1) {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  function handleBlur(event: FocusEvent<HTMLFieldSetElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) onBlur();
  }

  return (
    <fieldset onBlur={handleBlur} className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 p-0 text-[12.5px] font-bold text-ink">{label}</legend>
      <div className="flex gap-1.5">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              boxes.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={`Cyfra ${index + 1} z ${digits.length}`}
            value={digit}
            onChange={(e) => handleChange(index, e)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onFocus={(e) => e.target.select()}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={`${CELL} ${invalid ? "border-danger" : "border-line"} ${index === digits.length / 2 ? "ml-2" : ""}`}
          />
        ))}
      </div>
    </fieldset>
  );
}
