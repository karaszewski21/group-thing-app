import { useRef, type KeyboardEvent } from "react";
import { LAYOUT_REGISTRY } from "../layouts/registry";
import { nextIndex } from "./rovingIndex";

const LAYOUTS = Object.values(LAYOUT_REGISTRY);

interface LayoutTabProps {
  value: string;
  onSelect: (key: string) => void;
}

/** The layout cards, as a radio group in registry order. */
export function LayoutTab({ value, onSelect }: LayoutTabProps) {
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextIndex(event.key, index, LAYOUTS.length);
    if (next === null) return;
    event.preventDefault();
    onSelect(LAYOUTS[next].key);
    cardRefs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Układ strony" className="grid grid-cols-2 gap-2.5">
      {LAYOUTS.map((layout, index) => {
        const selected = layout.key === value;
        const recommended = layout.recommended ?? false;
        const labelId = `editor-layout-${layout.key}-label`;
        const badgeId = `editor-layout-${layout.key}-badge`;
        const descriptionId = `editor-layout-${layout.key}-description`;
        return (
          <button
            key={layout.key}
            ref={(element) => {
              cardRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-labelledby={labelId}
            aria-describedby={recommended ? `${badgeId} ${descriptionId}` : descriptionId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(layout.key)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`relative flex min-h-[44px] flex-col gap-1.5 rounded-2xl border-2 p-2.5 text-left font-sans focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
              selected ? "border-primary bg-primary-soft" : "border-line bg-paper"
            }`}
          >
            <img src={layout.thumbnail.src} alt={layout.thumbnail.alt} className="w-full rounded-xl" />
            <span id={labelId} className="text-sm font-bold text-ink">
              {layout.label}
            </span>
            {recommended && (
              <span
                id={badgeId}
                className="self-start rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-extrabold text-accent-fg"
              >
                Polecany
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
  );
}
