import { useRef, type KeyboardEvent } from "react";
import type { OrganizerCircle } from "../../../api/groups";
import { nextIndex } from "../editor/rovingIndex";

interface CircleFilterChipsProps {
  circles: Pick<OrganizerCircle, "id" | "name">[];
  /** The selected circle id; `undefined` = "Wszystkie". */
  selected: string | undefined;
  onSelect: (groupId: string | undefined) => void;
}

/** A single-choice circle filter ("Wszystkie" first) as a radiogroup with
 * roving focus. Not rendered for fewer than 2 circles. */
export function CircleFilterChips({ circles, selected, onSelect }: CircleFilterChipsProps) {
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  if (circles.length < 2) return null;
  const options = [{ id: undefined, name: "Wszystkie" }, ...circles];

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextIndex(event.key, index, options.length);
    if (next === null) return;
    event.preventDefault();
    onSelect(options[next].id);
    chipRefs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Filtruj według grupy" className="flex snap-x gap-2 overflow-x-auto pb-1">
      {options.map((option, index) => {
        const checked = option.id === selected;
        return (
          <button
            key={option.id ?? "all"}
            ref={(element) => {
              chipRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onSelect(option.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`min-h-[44px] shrink-0 snap-start whitespace-nowrap rounded-full border px-4 text-[13px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
              checked ? "border-ink bg-ink text-on-ink" : "border-line bg-paper text-ink"
            }`}
          >
            {option.name}
          </button>
        );
      })}
    </div>
  );
}
