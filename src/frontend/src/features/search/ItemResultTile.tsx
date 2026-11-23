import type { ProductSearchResult } from "../../api/search";
import { PhotoPlaceholder } from "../../components/shared/Icons";
import { ItemTileBadges } from "../../components/shared/ItemTileBadges";
import { Link } from "../../routing/navigation";
import dayjs from "../../utils/dayjs";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { SafeImage } from "../product/ItemGallery";

const PLACEHOLDER_TONE = { GIFT: "bg-primary-soft", SWAP: "bg-accent-soft" } as const;
const OFFER_BADGE = {
  GIFT: { label: "Oddam", tone: "bg-primary text-on-primary" },
  SWAP: { label: "Zamienię", tone: "bg-accent text-ink" },
} as const;

/** „Zarezerwowana do pt 21 lis” for a term's or event's reservation,
 * „Zarezerwowana” for a personal pickup or a pending proposal. */
function reservedCaption({ reserved, reserved_until }: ProductSearchResult["meta"]): string | undefined {
  if (!reserved) return undefined;
  return reserved_until ? `Zarezerwowana do ${dayjs(reserved_until).format("ddd D MMM")}` : "Zarezerwowana";
}

/** A product in the search grid: the photo (or a placeholder in the offer's
 * tone) with the Oddam / Zamienię badge in its corner, the name and the
 * condition; a reserved item stays listed, dimmed, with its reservation pill.
 * The whole tile opens the item. */
export function ItemResultTile({ result }: { result: ProductSearchResult }) {
  const { meta } = result;
  const caption = reservedCaption(meta);
  const dim = caption ? "opacity-60" : "";
  const offer = OFFER_BADGE[meta.mode];

  return (
    <article className="relative flex h-full flex-col rounded-[22px] border border-line bg-paper p-2.5 transition-colors hover:border-line-strong">
      <div className="relative">
        {meta.thumb_url ? (
          <SafeImage src={meta.thumb_url} alt="" className={`aspect-square w-full rounded-2xl object-cover ${dim}`} placeholderSize={32} />
        ) : (
          <span className={`flex aspect-square w-full items-center justify-center rounded-2xl ${PLACEHOLDER_TONE[meta.mode]} ${dim}`}>
            <PhotoPlaceholder size={32} />
          </span>
        )}
        <span
          className={`absolute top-1.5 left-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold shadow-[0_2px_8px_-2px_rgba(19,38,29,0.35)] md:top-2 md:left-2 md:px-2.5 md:py-1 md:text-xs ${offer.tone}`}
        >
          {offer.label}
        </span>
      </div>
      <Link
        to={result.href}
        className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-extrabold text-ink outline-none after:absolute after:inset-0 after:rounded-[22px] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring"
      >
        {result.title}
      </Link>
      <span className="mt-0.5 text-[13px] text-ink-soft">Stan: {CONDITION_LABELS[meta.condition] ?? meta.condition}</span>
      {caption && (
        <span className="mt-auto pt-2.5">
          <ItemTileBadges modes={[]} reservedCaption={caption} />
        </span>
      )}
    </article>
  );
}
