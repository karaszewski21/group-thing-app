import type { WantMatchResponse } from "../../api/wants";
import { ItemCard } from "../../components/shared/ItemCard";

function reservedCaption(match: WantMatchResponse): string | undefined {
  if (match.reserved_by_me) return "Zarezerwowane przez Ciebie";
  if (match.proposed_by_me) return "Twoja propozycja";
  return match.meta.reserved ? "Zarezerwowane" : undefined;
}

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
