import { useState } from "react";
import { FeaturedLabel } from "../../components/shared/ItemTileBadges";

/** The "Moje rzeczy" star of one listed item: a pressed/unpressed button
 * named with the item in both states (the state is `aria-pressed` only),
 * disabled while its save runs. */
export function FeaturedToggle({
  featured,
  onToggle,
  itemName,
}: {
  featured: boolean;
  onToggle: (featured: boolean) => Promise<void>;
  itemName: string;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await onToggle(!featured);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      aria-pressed={featured}
      aria-label={`Wyróżnij: ${itemName}`}
      disabled={busy}
      onClick={() => void toggle()}
      className={`min-h-9 flex-none rounded-full border-[1.5px] px-3.5 text-[13px] font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60 ${
        featured ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-paper text-ink hover:border-ink"
      }`}
    >
      {featured ? (
        <FeaturedLabel />
      ) : (
        <>
          <span aria-hidden="true">⭐</span>
          {" "}
          Wyróżnij
        </>
      )}
    </button>
  );
}
