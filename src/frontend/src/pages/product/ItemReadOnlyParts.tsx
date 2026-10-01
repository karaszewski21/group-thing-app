import type { ItemDetailsResponse } from "../../api/items";
import type { HistoryState } from "./itemPageShared";
import { ItemHistoryCard, ItemStatusCard } from "./ItemTimeline";

/** Status and history cards, shown below both the view and the edit content. */
export function ReadOnlyCards({ item, history }: { item: ItemDetailsResponse; history: HistoryState }) {
  return (
    <>
      <ItemStatusCard status={item.status} />
      <ItemHistoryCard
        entries={history.data}
        loading={history.loading}
        error={history.error}
        onRetry={() => void history.refetch()}
      />
    </>
  );
}

export function DescriptionText({ description }: { description: string | null }) {
  return description ? (
    <p className="mt-1.5 whitespace-pre-line break-words text-[13.5px] text-ink">{description}</p>
  ) : (
    <p className="mt-1.5 text-[13.5px] italic text-ink-soft">Brak opisu</p>
  );
}
