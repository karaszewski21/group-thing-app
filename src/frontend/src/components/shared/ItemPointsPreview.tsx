import type { ItemCondition } from "../../api/inventories";
import { useItemPointsPreview } from "../../hooks/useItemPointsPreview";

interface ItemPointsPreviewProps {
  categoryId: string | null;
  condition: ItemCondition;
}

/** Under the item create/edit fields: the points the system values the
 * item at for the picked category and condition, recomputed on each change. */
export function ItemPointsPreview({ categoryId, condition }: ItemPointsPreviewProps) {
  const { data, loading, error } = useItemPointsPreview(categoryId, condition);

  let text: string;
  if (!categoryId) text = "wybierz kategorię";
  else if (error) text = "nie udało się wyliczyć";
  else if (loading || data === null) text = "liczę…";
  else text = `${data} pkt`;

  return (
    <div className="rounded-[14px] bg-cream px-3.5 py-2.5 text-[12.5px] text-ink">
      <p>
        <span className="font-semibold text-ink-soft">Wycena systemu:</span>{" "}
        <strong aria-live="polite" className="font-extrabold">
          {text}
        </strong>
      </p>
      <p className="mt-0.5 text-[11.5px] text-ink-soft">
        Zależy od wielkości rzeczy (kategorii) i jej stanu. Tyle punktów dostaniesz, gdy oddasz ją za darmo.
      </p>
    </div>
  );
}
