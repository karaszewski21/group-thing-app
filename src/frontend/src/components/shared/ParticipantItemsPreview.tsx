import { Link } from "../../routing/navigation";
import type { ReservedByResponse } from "../../api/groups";
import type { ListingMode } from "../../api/itemListingPreferences";
import { SafeImage } from "../../features/product/ItemGallery";
import { itemPagePath } from "../../features/product/useItemRoutes";
import { PhotoPlaceholder } from "./Icons";
import { ItemTileBadges } from "./ItemTileBadges";

/** Items a participant preview shows; the rest sit behind "Pokaż więcej". */
export const PREVIEW_ITEM_LIMIT = 3;

export interface ParticipantPreviewItem {
  itemId: string;
  name: string;
  /** The modes it is offered in, shown as intent pills. */
  modes: ListingMode[];
  thumbUrl: string | null;
  /** Naive UTC ISO, no offset. */
  addedAt: string;
  /** `null` while available; a reserved row keeps its link and adds the reserved pill. */
  reservation: ReservedByResponse | null;
}


/** One row, a single link to the item's product page under the
 * participant's party id (the page moves it to their Organization slug). */
function ItemRow({ item, partyId }: { item: ParticipantPreviewItem; partyId: string }) {
  return (
    <div data-preview-item className="py-3">
      <Link
        to={itemPagePath(partyId, item.itemId)}
        className="flex items-center gap-3 rounded-xl text-ink no-underline hover:text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <span
          className={`flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cream ${item.reservation ? "opacity-60" : ""}`}
        >
          {item.thumbUrl === null ? (
            <PhotoPlaceholder size={20} />
          ) : (
            <SafeImage src={item.thumbUrl} alt="" className="size-full" placeholderSize={20} />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="block text-[15px] leading-snug wrap-break-word">{item.name}</span>{" "}
          <ItemTileBadges modes={item.modes} reservation={item.reservation} />{" "}
        </span>
        <span aria-hidden="true" className="shrink-0 text-ink-soft">
          ›
        </span>
      </Link>
    </div>
  );
}

/** A participant's newest items (at most `PREVIEW_ITEM_LIMIT`), each linking
 * to its product page, then "Pokaż więcej (N) ›" to the owner's items page
 * when they share more. Shared by the event and term pages. */
export function ParticipantItemsPreview({
  items,
  total,
  partyId,
}: {
  items: ParticipantPreviewItem[];
  total: number;
  partyId: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1 ml-13">
      <div className="divide-y divide-line">
        {items.slice(0, PREVIEW_ITEM_LIMIT).map((item) => (
          <ItemRow key={item.itemId} item={item} partyId={partyId} />
        ))}
      </div>
      {total > PREVIEW_ITEM_LIMIT && (
        <Link
          to={`/${partyId}/items`}
          className="mt-1 inline-flex min-h-11 items-center rounded text-sm font-extrabold text-primary-fg no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {`Pokaż więcej (${total})`}
          <span aria-hidden="true">{" ›"}</span>
        </Link>
      )}
    </div>
  );
}
