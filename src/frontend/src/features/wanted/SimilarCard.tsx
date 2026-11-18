import type { WantSimilarResponse } from "../../api/wants";
import { ItemCard } from "../../components/shared/ItemCard";
import { reservedCaption } from "./reservedCaption";

/** An item close in meaning to the want: the SuggestionCard tile without a
 * footnote, never marked "nowe". `onOpen` reports an opened tile. */
export function SimilarCard({ similar, onOpen }: { similar: WantSimilarResponse; onOpen: () => void }) {
  return (
    <li>
      <ItemCard
        href={similar.href}
        name={similar.title}
        condition={similar.meta.condition}
        thumbUrl={similar.meta.thumb_url}
        mode={similar.meta.mode}
        reservation={null}
        reservedCaption={reservedCaption(similar)}
        onOpen={onOpen}
        dashed
      />
    </li>
  );
}
