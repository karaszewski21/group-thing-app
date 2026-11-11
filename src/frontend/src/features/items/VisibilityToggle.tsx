import { Lock, LockOpen } from "lucide-react";
import type { ItemVisibility } from "../../api/itemListingPreferences";

/** Icon-only visibility switch of one listed item: an open lock is public,
 * a closed one private. Pressed means private; the caller saves the change
 * with the item's mode. */
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
  const isPrivate = value === "PRIVATE";
  const Icon = isPrivate ? Lock : LockOpen;
  return (
    <button
      type="button"
      aria-pressed={isPrivate}
      aria-label={`Prywatna: ${itemName}`}
      title={isPrivate ? "Prywatna — kliknij, aby upublicznić" : "Publiczna — kliknij, aby ukryć"}
      disabled={disabled}
      onClick={() => onChange(isPrivate ? "PUBLIC" : "PRIVATE")}
      className={`flex h-9 w-9 flex-none items-center justify-center rounded-full border-[1.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60 ${
        isPrivate ? "border-ink bg-ink text-on-ink" : "border-line bg-paper text-ink-soft hover:text-ink"
      }`}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={2.4} />
    </button>
  );
}
