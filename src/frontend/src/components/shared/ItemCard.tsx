import type { ReactNode } from "react";
import { Link } from "../../routing/navigation";
import type { ExchangeMode, ReservedByResponse } from "../../api/groups";
import type { ItemCondition } from "../../api/inventories";
import { PhotoPlaceholder } from "./Icons";
import { ItemTileBadges } from "./ItemTileBadges";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { SafeImage } from "../../features/product/ItemGallery";

const PLACEHOLDER_TONE: Record<ExchangeMode, string> = { GIFT: "bg-primary-soft", SWAP: "bg-accent-soft" };
const OFFER_BADGE: Record<ExchangeMode, { label: string; tone: string }> = {
  GIFT: { label: "Oddam", tone: "bg-primary text-on-primary" },
  SWAP: { label: "Zamienię", tone: "bg-accent text-ink" },
};
const CORNER_BADGE =
  "absolute top-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold shadow-[0_2px_8px_-2px_rgba(19,38,29,0.35)] md:top-2 md:px-2.5 md:py-1 md:text-xs";

interface ItemCardProps {
  /** The item page, opened by the whole tile (a stretched link on the name). */
  href: string;
  name: string;
  condition: string;
  thumbUrl: string | null;
  mode: ExchangeMode;
  /** `null` while available; a reserved tile keeps its link and offer badge. */
  reservation: ReservedByResponse | null;
  /** Marks the tile reserved with this text instead of the reserver's. */
  reservedCaption?: string;
  /** A short marker in the photo's right corner, e.g. "nowe". */
  marker?: string;
  /** Called when the link is opened, by a click or a middle-click (new tab). */
  onOpen?: () => void;
  /** A dashed border, for a tile that is only a suggestion. */
  dashed?: boolean;
  /** An extra line at the bottom. */
  footnote?: ReactNode;
}

/** The app's one item tile (search, home, owner and organization pages,
 * wants): the photo (or a placeholder in the offer's tone) with the Oddam /
 * Zamienię badge in its corner, the name and the condition; while reserved
 * the photo is dimmed and a reservation pill follows. The whole tile opens
 * the item page. Shows nothing about who listed it. */
export function ItemCard({
  href,
  name,
  condition,
  thumbUrl,
  mode,
  reservation,
  reservedCaption,
  marker,
  onOpen,
  dashed = false,
  footnote,
}: ItemCardProps) {
  const conditionLabel = CONDITION_LABELS[condition as ItemCondition] ?? condition;
  const reserved = Boolean(reservation || reservedCaption);
  const dim = reserved ? "opacity-60" : "";
  const offer = OFFER_BADGE[mode];

  return (
    <article
      className={`relative flex h-full flex-col rounded-[20px] border bg-paper p-2 transition-colors hover:border-line-strong md:rounded-[22px] md:p-2.5 ${dashed ? "border-dashed border-line-strong" : "border-line"}`}
    >
      <div className="relative">
        {thumbUrl ? (
          <SafeImage src={thumbUrl} alt="" className={`aspect-square w-full rounded-[14px] object-cover md:rounded-2xl ${dim}`} placeholderSize={32} />
        ) : (
          <span className={`flex aspect-square w-full items-center justify-center rounded-[14px] md:rounded-2xl ${PLACEHOLDER_TONE[mode]} ${dim}`}>
            <PhotoPlaceholder size={32} />
          </span>
        )}
        <span className={`${CORNER_BADGE} left-1.5 md:left-2 ${offer.tone}`}>{offer.label}</span>
        {marker && <span className={`${CORNER_BADGE} right-1.5 bg-paper text-ink md:right-2`}>{marker}</span>}
      </div>
      <Link
        to={href}
        onClick={onOpen}
        onAuxClick={(event) => {
          if (event.button === 1) onOpen?.();
        }}
        className="mt-2 line-clamp-2 text-sm leading-snug font-extrabold text-ink outline-none after:absolute after:inset-0 after:rounded-[20px] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring md:mt-2.5 md:text-[15px] md:after:rounded-[22px]"
      >
        {name}
      </Link>
      <span className="mt-0.5 text-xs text-ink-soft md:text-[13px]">Stan: {conditionLabel}</span>
      {reserved && (
        <span className="mt-auto pt-2">
          <ItemTileBadges modes={[]} reservation={reservation} reservedCaption={reservedCaption} />
        </span>
      )}
      {footnote && <p className="mt-1.5 text-xs text-ink-soft">{footnote}</p>}
    </article>
  );
}
