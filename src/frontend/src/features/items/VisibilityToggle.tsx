import type { ItemVisibility } from "../../api/itemListingPreferences";

const OPTIONS: { value: ItemVisibility; label: string }[] = [
  { value: "PUBLIC", label: "Publiczna" },
  { value: "PRIVATE", label: "Prywatna" },
];

/** Who sees one listed item: a two-way „Publiczna | Prywatna” switch (radio
 * buttons named with the item, so a list of tiles stays unambiguous). The
 * caller saves the change with the item's mode. */
export function VisibilityToggle({
  value,
  onChange,
  itemName,
  disabled = false,
}: {
  value: ItemVisibility;
  onChange: (visibility: ItemVisibility) => void;
  itemName: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Kto widzi rzecz ${itemName}`}
      className="grid flex-none grid-cols-2 gap-0.5 rounded-full bg-line p-0.5"
    >
      {OPTIONS.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${option.label}: ${itemName}`}
            disabled={disabled}
            onClick={() => {
              if (!on) onChange(option.value);
            }}
            className={`min-h-9 rounded-full px-3 text-[13px] font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60 ${
              on ? "bg-paper text-ink shadow-[0_2px_6px_-2px_rgba(19,38,29,0.25)]" : "text-ink-soft hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
