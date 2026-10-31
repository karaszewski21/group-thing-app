import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ListingMode } from "../../api/itemListingPreferences";
import { SafeImage } from "../../pages/product/ItemGallery";
import { itemContextQuery, organizerItemPath, type ItemContext } from "../../pages/product/useItemRoutes";
import { PREVIEW_MODE_LABELS } from "../../pages/term/components/termLabels";
import dayjs from "../../utils/dayjs";
import { PhotoPlaceholder } from "./Icons";

/** Items a participant preview shows; the rest sit behind "Pokaż więcej". */
export const PREVIEW_ITEM_LIMIT = 3;

export interface ParticipantPreviewItem {
  itemId: string;
  name: string;
  /** The modes it is offered in, labelled "Zamiana" / "Weź na stałe". */
  modes: ListingMode[];
  thumbUrl: string | null;
  /** Naive UTC ISO, no offset. */
  addedAt: string;
}

/** "dodano dziś" / "dodano wczoraj" by calendar day, "tydzień temu" for the
 * second week, else dayjs' Polish relative time ("3 dni temu"). */
function addedAgo(addedAt: string): string {
  const added = dayjs.utc(addedAt).local();
  const days = dayjs().startOf("day").diff(added.startOf("day"), "day");
  if (days <= 0) return "dodano dziś";
  if (days === 1) return "dodano wczoraj";
  if (days < 7) return `${days} dni temu`;
  if (days < 14) return "tydzień temu";
  return added.fromNow();
}

function ItemRow({
  item,
  organizerSlug,
  context,
  actions,
}: {
  item: ParticipantPreviewItem;
  organizerSlug: string | null;
  context: ItemContext | null;
  actions: ReactNode;
}) {
  const modes = item.modes.map((mode) => PREVIEW_MODE_LABELS[mode]).join(" / ");
  const meta = [modes, addedAgo(item.addedAt)].filter(Boolean).join(" · ");
  return (
    <div data-preview-item className="py-3">
      <Link
        to={organizerItemPath(organizerSlug, item.itemId, context)}
        className="flex items-center gap-3 rounded-xl text-ink no-underline hover:text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cream">
          {item.thumbUrl === null ? (
            <PhotoPlaceholder size={20} />
          ) : (
            <SafeImage src={item.thumbUrl} alt="" className="size-full" placeholderSize={20} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug wrap-break-word">{item.name}</span>{" "}
          <small className="block text-xs text-ink-soft">{meta}</small>
        </span>
      </Link>
      {actions && <div className="ml-15">{actions}</div>}
    </div>
  );
}

/** A participant's newest items (at most `PREVIEW_ITEM_LIMIT`), each linking
 * to its item page with the term/event context, then "Pokaż więcej (N) ›" to
 * the owner's items page when they share more. Shared by the event and term
 * pages; `renderActions` adds per-item content below a row (the term page's
 * take buttons). */
export function ParticipantItemsPreview({
  items,
  total,
  partyId,
  context,
  organizerSlug,
  renderActions,
}: {
  items: ParticipantPreviewItem[];
  total: number;
  partyId: string;
  context: ItemContext | null;
  organizerSlug: string | null;
  renderActions?: (item: ParticipantPreviewItem) => ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1 ml-13">
      <div className="divide-y divide-line">
        {items.slice(0, PREVIEW_ITEM_LIMIT).map((item) => (
          <ItemRow
            key={item.itemId}
            item={item}
            organizerSlug={organizerSlug}
            context={context}
            actions={renderActions?.(item)}
          />
        ))}
      </div>
      {total > PREVIEW_ITEM_LIMIT && (
        <Link
          to={`/${partyId}/items${itemContextQuery(context)}`}
          className="mt-1 inline-flex min-h-11 items-center rounded text-sm font-extrabold text-primary-fg no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {`Pokaż więcej (${total})`}
          <span aria-hidden="true">{" ›"}</span>
        </Link>
      )}
    </div>
  );
}
