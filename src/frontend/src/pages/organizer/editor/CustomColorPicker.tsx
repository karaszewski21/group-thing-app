import { useEffect, useState } from "react";
import type { OrganizerTheme } from "../../../api/groups";
import { describeColorAdjustment, resolveOrgTheme } from "../../../theme/orgPalette";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FORMAT_ERROR = "Podaj kolor w formacie #RRGGBB";
const LABEL = "text-xs font-extrabold tracking-wide text-ink-soft";

interface ColorFieldProps {
  id: string;
  /** Accessible name when no visible `<label for>` points at the text input. */
  label?: string;
  pickerLabel: string;
  text: string;
  color: string;
  disabled?: boolean;
  onText: (text: string) => void;
}

/** A native color picker paired with a hex text input; the text input is the
 * one that can hold an invalid value and shows the format error. */
function ColorField({ id, label, pickerLabel, text, color, disabled = false, onText }: ColorFieldProps) {
  const invalid = !disabled && !HEX_COLOR.test(text);
  const errorId = `${id}-error`;
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={pickerLabel}
          value={color.toLowerCase()}
          disabled={disabled}
          onChange={(event) => onText(event.target.value)}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-xl border border-line bg-paper p-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <input
          id={id}
          type="text"
          inputMode="text"
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          value={text}
          disabled={disabled}
          maxLength={7}
          onChange={(event) => onText(event.target.value)}
          className={`min-h-[44px] w-full rounded-xl border-[1.5px] bg-paper px-3 font-mono text-sm text-ink outline-none focus-visible:border-focus-ring disabled:opacity-50 ${
            invalid ? "border-danger" : "border-line"
          }`}
        />
      </div>
      {invalid && (
        <p id={errorId} className="mt-1.5 text-[12.5px] font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {FORMAT_ERROR}
        </p>
      )}
    </div>
  );
}

/** Keeps a hex text input in step with its draft color: an outside change
 * (another tile, Anuluj) replaces the text, while an invalid entry stays
 * visible without touching the draft. */
function useHexText(value: string | null) {
  const [text, setText] = useState(value ?? "");
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value ?? "");
  }
  return [text, setText] as const;
}

interface CustomColorPickerProps {
  theme: OrganizerTheme;
  onChange: (theme: OrganizerTheme) => void;
  /** Reports whether an entered color is invalid, so saving can be blocked. */
  onInvalidChange: (invalid: boolean) => void;
}

/** The "Własny" palette: a required primary color and an optional accent. */
export function CustomColorPicker({ theme, onChange, onInvalidChange }: CustomColorPickerProps) {
  const [primaryText, setPrimaryText] = useHexText(theme.primary_color);
  const [accentText, setAccentText] = useHexText(theme.accent_color);
  const customAccent = theme.accent_color !== null;
  const invalid = !HEX_COLOR.test(primaryText) || (customAccent && !HEX_COLOR.test(accentText));
  const resolved = resolveOrgTheme({ palette_preset: null, primary_color: theme.primary_color, accent_color: null });

  useEffect(() => onInvalidChange(invalid), [invalid, onInvalidChange]);
  useEffect(() => () => onInvalidChange(false), [onInvalidChange]);

  function enterPrimary(raw: string) {
    if (!HEX_COLOR.test(raw)) {
      setPrimaryText(raw);
      return;
    }
    const hex = raw.toUpperCase();
    setPrimaryText(hex);
    onChange({ ...theme, primary_color: hex });
  }

  function enterAccent(raw: string) {
    if (!HEX_COLOR.test(raw)) {
      setAccentText(raw);
      return;
    }
    const hex = raw.toUpperCase();
    setAccentText(hex);
    onChange({ ...theme, accent_color: hex });
  }

  const adjustment =
    theme.primary_color && HEX_COLOR.test(theme.primary_color) ? describeColorAdjustment(theme.primary_color) : null;
  const hint = adjustment?.tooLight
    ? "Ten kolor jest bardzo jasny — przyciemniliśmy go wyraźnie, żeby tekst był czytelny."
    : adjustment?.primaryDarkened
      ? "Lekko przyciemniliśmy kolor dla czytelności."
      : "";

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-line bg-cream p-4 font-sans">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="editor-primary-hex" className={LABEL}>
          Kolor główny *
        </label>
        <ColorField
          id="editor-primary-hex"
          pickerLabel="Wybierz kolor główny"
          text={primaryText}
          color={theme.primary_color ?? resolved["--color-primary"]}
          onText={enterPrimary}
        />
        <p role="status" className="text-[12.5px] text-ink-soft">
          {hint && (
            <>
              <span aria-hidden="true">ⓘ </span>
              {hint}
            </>
          )}
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className={`${LABEL} mb-1.5`}>Akcent</legend>
        <label className="flex min-h-[44px] items-center gap-2 text-sm font-semibold text-ink">
          <input
            type="radio"
            name="editor-accent"
            checked={!customAccent}
            onChange={() => onChange({ ...theme, accent_color: null })}
            className="h-4 w-4 accent-primary"
          />
          Automatyczny
        </label>
        <div className="flex items-center gap-2">
          <label className="flex min-h-[44px] shrink-0 items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="radio"
              name="editor-accent"
              checked={customAccent}
              onChange={() => onChange({ ...theme, accent_color: resolved["--color-accent"].toUpperCase() })}
              className="h-4 w-4 accent-primary"
            />
            Własny
          </label>
          <div className="min-w-0 flex-1">
            <ColorField
              id="editor-accent-hex"
              label="Kolor akcentu"
              pickerLabel="Wybierz kolor akcentu"
              text={accentText}
              color={theme.accent_color ?? resolved["--color-accent"]}
              disabled={!customAccent}
              onText={enterAccent}
            />
          </div>
        </div>
      </fieldset>
    </div>
  );
}
