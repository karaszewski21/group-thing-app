import type { WantMatchResponse } from "../../api/wants";
import { ItemCard } from "../../components/shared/ItemCard";
import { reservedCaption } from "./reservedCaption";

/** One matching item on a want's match list. The tile is one link, so a
 * click anywhere on it opens the item; `onOpen` reports that, also for a
 * middle-click into a new tab. */
export function MatchCard({
  match,
  isNew,
  onOpen,
}: {
  match: WantMatchResponse;
  /** New when the page was opened; stays for the whole visit. */
  isNew: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <ItemCard
        href={match.href}
        name={match.title}
        condition={match.meta.condition}
        thumbUrl={match.meta.thumb_url}
        mode={match.meta.mode}
        reservation={null}
        reservedCaption={reservedCaption(match)}
        marker={isNew ? "nowe" : undefined}
        onOpen={onOpen}
      />
    </li>
  );
}
