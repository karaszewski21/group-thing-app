import { Link } from "react-router-dom";
import type { ExchangeMode, OrganizerExchangeItem } from "../../../api/groups";
import type { ItemCondition } from "../../../api/inventories";
import { PhotoPlaceholder } from "../../../components/shared/Icons";
import dayjs from "../../../utils/dayjs";
import { CONDITION_LABELS } from "../../../utils/productCategory";
import { EXCHANGE_MODE_LABELS, EXCHANGE_MODE_TONE } from "../../term/components/termLabels";
import { SafeImage } from "../../product/ItemGallery";
import { organizerItemPath } from "../../product/useItemRoutes";
import { organizerTermPath } from "../organizerHelpers";

const CHIP = "mt-auto flex min-h-11 flex-col items-center justify-center rounded-xl px-2 pt-1.5 pb-1 text-center";

interface ItemCardProps {
  /** The item page, opened by the whole tile (a stretched link on the name). */
  href: string;
  name: string;
  condition: string;
  thumbUrl: string | null;
  mode: ExchangeMode;
  /** The chip's mode wording, e.g. "Zamienię" or "Weź". */
  modeLabel: string;
  /** A pickup date for the chip, e.g. "Śr 14 paź". */
  date?: string;
  /** Makes the chip its own link (above the stretched one), e.g. to the pickup term. */
  pickup?: { href: string; ariaLabel: string };
}

/** A neutral item tile: thumbnail (or placeholder), name, condition and a
 * mode chip. Shows nothing about who listed it. */
export function ItemCard({ href, name, condition, thumbUrl, mode, modeLabel, date, pickup }: ItemCardProps) {
  const conditionLabel = CONDITION_LABELS[condition as ItemCondition] ?? condition;

  return (
    <article className="relative flex h-full flex-col rounded-2xl border border-line bg-paper p-2.5">
      {thumbUrl ? (
        <SafeImage src={thumbUrl} alt="" className="aspect-square w-full rounded-xl object-cover" placeholderSize={32} />
      ) : (
        <span className="flex aspect-square w-full items-center justify-center rounded-xl bg-cream">
          <PhotoPlaceholder size={32} />
        </span>
      )}
      <Link
        to={href}
        className="mt-2 line-clamp-2 text-[13px] font-bold text-ink outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring"
      >
        {name}
      </Link>
      <span className="mt-0.5 mb-2 text-[11px] text-ink-soft">{conditionLabel}</span>
      {pickup ? (
        <Link
          to={pickup.href}
          aria-label={pickup.ariaLabel}
          className={`relative z-10 ${CHIP} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${EXCHANGE_MODE_TONE[mode]}`}
        >
          <span className="text-[13px] font-extrabold">{modeLabel}</span>
          {date && <span className="text-[11px]">{date}</span>}
        </Link>
      ) : (
        <span className={`${CHIP} text-[12px] font-extrabold ${EXCHANGE_MODE_TONE[mode]}`}>
          {date ? `${modeLabel} · ${date}` : modeLabel}
        </span>
      )}
    </article>
  );
}

interface ExchangeItemCardProps {
  slug: string;
  item: OrganizerExchangeItem;
}

/** One exchange board item: the tile opens the item page, its mode button
 * the nearest term, where the item is taken. */
export function ExchangeItemCard({ slug, item }: ExchangeItemCardProps) {
  const mode = EXCHANGE_MODE_LABELS[item.mode];
  const pickup = dayjs(item.occurs_on).format("dd D MMM");

  return (
    <ItemCard
      href={organizerItemPath(slug, item.item_id)}
      name={item.product_name}
      condition={item.condition}
      thumbUrl={item.thumb_url}
      mode={item.mode}
      modeLabel={mode}
      date={pickup}
      pickup={{
        href: organizerTermPath(slug, item.group_id, item.term_id),
        ariaLabel: `${mode}: ${item.product_name}, odbiór ${pickup}`,
      }}
    />
  );
}
