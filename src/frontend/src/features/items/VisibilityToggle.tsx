import type { ItemVisibility } from "../../api/itemListingPreferences";

const OPTIONS: { value: ItemVisibility; icon: string; label: string }[] = [
  { value: "PUBLIC", icon: "🌍", label: "Publiczna" },
  { value: "PRIVATE", icon: "🔒", label: "Prywatna" },
];

/** The "🌍 Publiczna / 🔒 Prywatna" segmented control of one listed item.
 * Calls back only on a change; the caller saves it with the item's mode. */
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
      role="group"
      aria-label={`Widoczność: ${itemName}`}
      className="inline-flex overflow-hidden rounded-xl border border-line-strong text-[13px] font-extrabold"
    >
      {OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => {
              if (!on) onChange(o.value);
            }}
            className={`min-h-9 px-3 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60 ${
              on ? "bg-ink text-on-ink" : "bg-paper text-ink-soft hover:text-ink"
            }`}
          >
            <span aria-hidden="true">{o.icon}</span> {o.label}
          </button>
        );
      })}
    </div>
  );
}
