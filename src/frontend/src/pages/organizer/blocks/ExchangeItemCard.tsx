import { Link } from "react-router-dom";
import type { OrganizerExchangeItem } from "../../../api/groups";
import type { ItemCondition } from "../../../api/inventories";
import { PhotoPlaceholder } from "../../../components/shared/Icons";
import dayjs from "../../../utils/dayjs";
import { CONDITION_LABELS } from "../../../utils/productCategory";
import { EXCHANGE_MODE_LABELS, EXCHANGE_MODE_TONE } from "../../term/components/termLabels";
import { SafeImage } from "../../product/ItemGallery";
import { organizerItemPath } from "../../product/useItemRoutes";
import { organizerTermPath } from "../organizerHelpers";

interface ExchangeItemCardProps {
  slug: string;
  item: OrganizerExchangeItem;
}

/** One exchange item. The whole tile opens the item page (a stretched link on
 * the name); its mode button opens the nearest term, where the item is taken.
 * Shows nothing about who listed it. */
export function ExchangeItemCard({ slug, item }: ExchangeItemCardProps) {
  const condition = CONDITION_LABELS[item.condition as ItemCondition] ?? item.condition;
  const mode = EXCHANGE_MODE_LABELS[item.mode];
  const pickup = dayjs(item.occurs_on).format("dd D MMM");

  return (
    <article className="relative flex h-full flex-col rounded-2xl border border-line bg-paper p-2.5">
      {item.thumb_url ? (
        <SafeImage
          src={item.thumb_url}
          alt=""
          className="aspect-square w-full rounded-xl object-cover"
          placeholderSize={32}
        />
      ) : (
        <span className="flex aspect-square w-full items-center justify-center rounded-xl bg-cream">
          <PhotoPlaceholder size={32} />
        </span>
      )}
      <Link
        to={organizerItemPath(slug, item.item_id)}
        className="mt-2 line-clamp-2 text-[13px] font-bold text-ink outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring"
      >
        {item.product_name}
      </Link>
      <span className="mt-0.5 mb-2 text-[11px] text-ink-soft">{condition}</span>
      <Link
        to={organizerTermPath(slug, item.group_id, item.term_id)}
        aria-label={`${mode}: ${item.product_name}, odbiór ${pickup}`}
        className={`relative z-10 mt-auto flex min-h-11 flex-col items-center justify-center rounded-xl px-2 pt-1.5 pb-1 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${EXCHANGE_MODE_TONE[item.mode]}`}
      >
        <span className="text-[13px] font-extrabold">{mode}</span>
        <span className="text-[11px]">{pickup}</span>
      </Link>
    </article>
  );
}
