import { useRef, type KeyboardEvent } from "react";
import type { OrganizerTheme } from "../../../api/groups";
import { DEFAULT_THEME_VARS, type ThemeVars } from "../../../theme/orgPalette";
import { PALETTE_PRESETS } from "../../../theme/palettePresets";
import { CustomColorPicker } from "./CustomColorPicker";
import { DEFAULT_THEME, paletteSelection } from "./draft";
import { PreviewCards } from "./PreviewCards";
import { nextIndex } from "./rovingIndex";

interface Tile {
  key: string;
  label: string;
  /** Swatch colors; the "Własny" tile has none and shows a dashed "+". */
  vars?: ThemeVars;
}

const TILES: Tile[] = [
  { key: "DEFAULT", label: "Mięta (domyślna)", vars: DEFAULT_THEME_VARS },
  ...PALETTE_PRESETS.map(({ key, label, vars }) => ({ key, label, vars })),
  { key: "CUSTOM", label: "Własny" },
];

const SECTION_LABEL = "text-xs font-extrabold tracking-wide text-ink-soft";

interface ColorsTabProps {
  theme: OrganizerTheme;
  onChange: (theme: OrganizerTheme) => void;
  onCustomInvalidChange: (invalid: boolean) => void;
}

/** The palette tiles, the "Własny" picker, sample previews and the reset link. */
export function ColorsTab({ theme, onChange, onCustomInvalidChange }: ColorsTabProps) {
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selection = paletteSelection(theme);

  function themeFor(tile: Tile): OrganizerTheme {
    if (tile.key === "DEFAULT") return DEFAULT_THEME;
    if (tile.vars) {
      return { palette_preset: tile.key, primary_color: tile.vars["--color-primary"], accent_color: tile.vars["--color-accent"] };
    }
    const primary = theme.primary_color ?? DEFAULT_THEME_VARS["--color-primary"];
    return { palette_preset: null, primary_color: primary.toUpperCase(), accent_color: theme.accent_color };
  }

  function select(tile: Tile) {
    if (tile.key !== selection) onChange(themeFor(tile));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextIndex(event.key, index, TILES.length);
    if (next === null) return;
    event.preventDefault();
    select(TILES[next]);
    tileRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col font-sans">
      <p className={`${SECTION_LABEL} mb-2`}>
        Gotowe palety
      </p>
      <div role="radiogroup" aria-label="Paleta kolorów" className="grid grid-cols-4 gap-2">
        {TILES.map((tile, index) => {
          const selected = tile.key === selection;
          return (
            <button
              key={tile.key}
              ref={(element) => {
                tileRefs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tile)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`relative flex min-h-[44px] flex-col items-center gap-1.5 rounded-2xl border border-line bg-paper px-1 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                selected ? "ring-2 ring-ink" : ""
              }`}
            >
              {tile.vars ? (
                <span
                  aria-hidden="true"
                  className="h-9 w-9 rounded-full border border-line"
                  style={{
                    background: `linear-gradient(90deg, ${tile.vars["--color-primary"]} 50%, ${tile.vars["--color-accent"]} 50%)`,
                  }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-line-strong text-lg font-bold text-ink-soft"
                >
                  +
                </span>
              )}
              <span className="text-center text-[11.5px] font-bold leading-tight text-ink">{tile.label}</span>
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-extrabold text-on-ink"
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selection === "CUSTOM" && (
        <CustomColorPicker theme={theme} onChange={onChange} onInvalidChange={onCustomInvalidChange} />
      )}

      <h3 className={`${SECTION_LABEL} mb-2 mt-4`}>Podgląd</h3>
      <PreviewCards />

      <button
        type="button"
        onClick={() => onChange(DEFAULT_THEME)}
        disabled={selection === "DEFAULT"}
        className="mt-3 min-h-[44px] self-start text-sm font-bold text-primary-fg underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        Przywróć domyślne
      </button>
    </div>
  );
}
