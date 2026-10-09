import { Link } from "react-router-dom";
import type { OrganizerExchangeItem } from "../../../api/groups";
import type { ItemCondition } from "../../../api/inventories";
import { PhotoPlaceholder } from "../../../components/shared/Icons";
import dayjs from "../../../utils/dayjs";
import { CONDITION_LABELS } from "../../../utils/productCategory";
import { EXCHANGE_MODE_LABELS, EXCHANGE_MODE_TONE } from "../../krag/components/termLabels";
import { SafeImage } from "../../product/ItemGallery";

interface ExchangeItemCardProps {
  slug: string;
  item: OrganizerExchangeItem;
}

/** One exchange item linking to its term page, where the action happens.
 * Shows nothing about who listed it. */
export function ExchangeItemCard({ slug, item }: ExchangeItemCardProps) {
  const condition = CONDITION_LABELS[item.condition as ItemCondition] ?? item.condition;
  return (
    <Link
      to={`/${slug}/grupa/${item.group_id}/term/${item.term_id}`}
      className="flex h-full flex-col rounded-2xl border border-line bg-paper p-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      {item.thumb_url ? (
        <SafeImage
          src={item.thumb_url}
          alt={item.product_name}
          className="aspect-square w-full rounded-xl object-cover"
          placeholderSize={32}
        />
      ) : (
        <span className="flex aspect-square w-full items-center justify-center rounded-xl bg-cream">
          <PhotoPlaceholder size={32} />
        </span>
      )}
      <span className="mt-2 line-clamp-2 text-[13px] font-bold text-ink">{item.product_name}</span>
      <span className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${EXCHANGE_MODE_TONE[item.mode]}`}>
          {EXCHANGE_MODE_LABELS[item.mode]}
        </span>
        <span className="text-[11px] text-ink-soft">{condition}</span>
      </span>
      <span className="mt-1 text-[12px] text-ink-soft">odbiór: {dayjs(item.occurs_on).format("dd D MMM")}</span>
    </Link>
  );
}
