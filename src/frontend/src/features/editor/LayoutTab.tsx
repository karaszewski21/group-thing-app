import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { nextIndex } from "../../components/shared/rovingIndex";

/** One layout card. A `locked` layout is shown but cannot be chosen. */
export interface LayoutOption {
  key: string;
  label: string;
  description: string;
  thumbnail: { src: string; alt: string };
  recommended?: boolean;
  locked?: boolean;
}

interface LayoutTabProps {
  value: string;
  options: LayoutOption[];
  onSelect: (key: string) => void;
  /** Why the locked layouts are locked, shown above them, with an id the
   * locked cards point to. */
  lockedNote?: ReactNode;
}

const LOCKED_NOTE_ID = "editor-layout-locked-note";

/** The layout cards, as a radio group in `options` order. Locked cards are
 * `aria-disabled` and skipped by the arrow keys. */
export function LayoutTab({ value, options, onSelect, lockedNote }: LayoutTabProps) {
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectable = options.filter((option) => !option.locked);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, key: string) {
    const index = selectable.findIndex((option) => option.key === key);
    const next = nextIndex(event.key, index, selectable.length);
    if (next === null) return;
    event.preventDefault();
    const target = selectable[next];
    onSelect(target.key);
    cardRefs.current[options.indexOf(target)]?.focus();
  }

  return (
    <div className="flex flex-col gap-2.5">
      {lockedNote && options.some((option) => option.locked) && (
        <div id={LOCKED_NOTE_ID} className="rounded-2xl bg-accent-soft p-3 text-[12.5px] text-ink">
          {lockedNote}
        </div>
      )}
      <div role="radiogroup" aria-label="Układ strony" className="grid grid-cols-2 gap-2.5">
        {options.map((layout, index) => {
          const selected = layout.key === value;
          const labelId = `editor-layout-${layout.key}-label`;
          const badgeId = `editor-layout-${layout.key}-badge`;
          const descriptionId = `editor-layout-${layout.key}-description`;
          const describedBy = [
            layout.recommended ? badgeId : null,
            descriptionId,
            layout.locked && lockedNote ? LOCKED_NOTE_ID : null,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={layout.key}
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={layout.locked || undefined}
              aria-labelledby={labelId}
              aria-describedby={describedBy}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                if (!layout.locked) onSelect(layout.key);
              }}
              onKeyDown={(event) => handleKeyDown(event, layout.key)}
              className={`relative flex min-h-[44px] flex-col gap-1.5 rounded-2xl border-2 p-2.5 text-left font-sans focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                selected ? "border-primary bg-primary-soft" : "border-line bg-paper"
              } ${layout.locked ? "cursor-not-allowed" : ""}`}
            >
              <img
                src={layout.thumbnail.src}
                alt={layout.thumbnail.alt}
                className={`w-full rounded-xl ${layout.locked ? "opacity-50 grayscale" : ""}`}
              />
              <span id={labelId} className="text-sm font-bold text-ink">
                {layout.label}
              </span>
              {layout.recommended && (
                <span
                  id={badgeId}
                  className="self-start rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-extrabold text-accent-fg"
                >
                  Polecany
                </span>
              )}
              {layout.locked && (
                <span className="self-start rounded-full bg-cream px-2 py-0.5 text-[11px] font-extrabold text-ink-soft">
                  <span aria-hidden="true">🔒 </span>
                  Dla organizacji
                </span>
              )}
              <span id={descriptionId} className="text-[12px] text-ink-soft">
                {layout.description}
              </span>
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-on-primary"
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
