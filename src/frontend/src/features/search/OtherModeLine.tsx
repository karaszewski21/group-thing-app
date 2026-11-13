import type { SearchMode } from "../../api/search";
import { pluralPl } from "../../utils/plural";

// eslint-disable-next-line react-refresh/only-export-components -- SearchView's count line shares the nouns
export const SEARCH_MODE_NOUNS: Record<SearchMode, [string, string, string]> = {
  items: ["przedmiot", "przedmioty", "przedmiotów"],
  events: ["spotkanie", "spotkania", "spotkań"],
};

/** „3 spotkania pasują do „q” →”: switches to the other mode with the same
 * `q`. Highlighted under an empty list; nothing when the other mode has no
 * results. */
export function OtherModeLine({
  otherMode,
  count,
  q,
  highlighted,
  onSwitch,
}: {
  otherMode: SearchMode;
  count: number;
  q: string;
  highlighted: boolean;
  onSwitch: (mode: SearchMode) => void;
}) {
  if (count === 0) return null;
  const noun = pluralPl(count, ...SEARCH_MODE_NOUNS[otherMode]);
  const verb = pluralPl(count, "pasuje", "pasują", "pasuje");
  return (
    <button
      type="button"
      data-highlighted={highlighted}
      onClick={() => onSwitch(otherMode)}
      className={`mt-4 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-2xl px-4 text-center text-sm font-extrabold text-primary-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
        highlighted ? "bg-primary-soft py-3" : ""
      }`}
    >
      {count} {noun} {verb} do „{q}”{" "}
      <span aria-hidden="true">→</span>
    </button>
  );
}
