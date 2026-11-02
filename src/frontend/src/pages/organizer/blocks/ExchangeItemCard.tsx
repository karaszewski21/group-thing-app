import { Link } from "react-router-dom";
import type { ExchangeMode, OrganizerExchangeItem, ReservedByResponse } from "../../../api/groups";
import type { ItemCondition } from "../../../api/inventories";
import { PhotoPlaceholder } from "../../../components/shared/Icons";
import { ItemTileBadges } from "../../../components/shared/ItemTileBadges";
import { CONDITION_LABELS } from "../../../utils/productCategory";
import { SafeImage } from "../../product/ItemGallery";
import { organizerItemPath } from "../../product/useItemRoutes";

interface ItemCardProps {
  /** The item page, opened by the whole tile (a stretched link on the name). */
  href: string;
  name: string;
  condition: string;
  thumbUrl: string | null;
  mode: ExchangeMode;
  /** `null` while available; a reserved tile keeps its link and intent pill. */
  reservation: ReservedByResponse | null;
}

/** A neutral item tile: thumbnail (or placeholder), name, condition, the
 * intent pill and, while reserved, the reserved pill (thumbnail dimmed); the
 * whole tile opens the product page. Shows nothing about who listed it. */
export function ItemCard({ href, name, condition, thumbUrl, mode, reservation }: ItemCardProps) {
  const conditionLabel = CONDITION_LABELS[condition as ItemCondition] ?? condition;
  const dim = reservation ? "opacity-60" : "";

  return (
    <article className="relative flex h-full flex-col rounded-2xl border border-line bg-paper p-2.5">
      {thumbUrl ? (
        <SafeImage src={thumbUrl} alt="" className={`aspect-square w-full rounded-xl object-cover ${dim}`} placeholderSize={32} />
      ) : (
        <span className={`flex aspect-square w-full items-center justify-center rounded-xl bg-cream ${dim}`}>
          <PhotoPlaceholder size={32} />
        </span>
      )}
      <Link
        to={href}
        className="mt-2 line-clamp-2 text-[13px] font-bold text-ink outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring"
      >
        {name}
      </Link>
      <span className="mt-0.5 mb-2 text-[11px] text-ink-soft">Stan: {conditionLabel}</span>
      <span className="mt-auto">
        <ItemTileBadges modes={[mode]} reservation={reservation} />
      </span>
    </article>
  );
}

interface ExchangeItemCardProps {
  slug: string;
  item: OrganizerExchangeItem;
}

/** One exchange board item: the tile opens its product page. */
export function ExchangeItemCard({ slug, item }: ExchangeItemCardProps) {
  return (
    <ItemCard
      href={organizerItemPath(slug, item.item_id)}
      name={item.product_name}
      condition={item.condition}
      thumbUrl={item.thumb_url}
      mode={item.mode}
      reservation={item.reservation}
    />
  );
}
