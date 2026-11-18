import type { ReactNode } from "react";
import { Link } from "../../routing/navigation";
import type { ExchangeMode, ReservedByResponse } from "../../api/groups";
import type { ItemCondition } from "../../api/inventories";
import { PhotoPlaceholder } from "./Icons";
import { ItemTileBadges } from "./ItemTileBadges";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { SafeImage } from "../../features/product/ItemGallery";

interface ItemCardProps {
  /** The item page, opened by the whole tile (a stretched link on the name). */
  href: string;
  name: string;
  condition: string;
  thumbUrl: string | null;
  mode: ExchangeMode;
  /** `null` while available; a reserved tile keeps its link and intent pill. */
  reservation: ReservedByResponse | null;
  /** Marks the tile reserved with this text instead of the reserver's. */
  reservedCaption?: string;
  /** A short marker over the thumbnail's corner, e.g. "nowe". */
  marker?: string;
  /** Called when the link is opened, by a click or a middle-click (new tab). */
  onOpen?: () => void;
  /** A dashed border, for a tile that is only a suggestion. */
  dashed?: boolean;
  /** An extra line under the badges. */
  footnote?: ReactNode;
}

/** A neutral item tile: thumbnail (or placeholder), name, condition, the
 * intent pill and, while reserved, the reserved pill (thumbnail dimmed); the
 * whole tile opens the product page. Shows nothing about who listed it. */
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
  const dim = reservation || reservedCaption ? "opacity-60" : "";

  return (
    <article
      className={`relative flex h-full flex-col rounded-2xl border bg-paper p-2.5 ${dashed ? "border-dashed border-line-strong" : "border-line"}`}
    >
      {thumbUrl ? (
        <SafeImage src={thumbUrl} alt="" className={`aspect-square w-full rounded-xl object-cover ${dim}`} placeholderSize={32} />
      ) : (
        <span className={`flex aspect-square w-full items-center justify-center rounded-xl bg-cream ${dim}`}>
          <PhotoPlaceholder size={32} />
        </span>
      )}
      {marker && (
        <span className="absolute top-4 left-4 rounded-full bg-primary px-2 py-0.5 text-[11px] font-extrabold text-on-primary">
          {marker}
        </span>
      )}
      <Link
        to={href}
        onClick={onOpen}
        onAuxClick={(event) => {
          if (event.button === 1) onOpen?.();
        }}
        className="mt-2 line-clamp-2 text-[13px] font-bold text-ink outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus-ring"
      >
        {name}
      </Link>
      <span className="mt-0.5 mb-2 text-[11px] text-ink-soft">Stan: {conditionLabel}</span>
      <span className="mt-auto">
        <ItemTileBadges modes={[mode]} reservation={reservation} reservedCaption={reservedCaption} />
      </span>
      {footnote && <p className="mt-1.5 text-xs text-ink-soft">{footnote}</p>}
    </article>
  );
}
