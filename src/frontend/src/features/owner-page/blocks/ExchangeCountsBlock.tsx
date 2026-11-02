import { Link } from "../../../routing/navigation";
import type { OrganizerExchangeCounts, OrganizerExchangeItem, OrganizerPageResponse } from "../../../api/groups";
import { EXCHANGE_MODE_TONE, INTENT_LABELS } from "../../terms/components/termLabels";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { exchangeTotal, organizerTermPath } from "../organizerHelpers";

type CountKey = keyof OrganizerExchangeCounts;

/** The three counts in mockup order; a mode counts only its available items. */
const COUNT_TILES: { key: CountKey; label: string; tone: string; matches: (item: OrganizerExchangeItem) => boolean }[] = [
  { key: "GIFT", label: INTENT_LABELS.GIFT, tone: EXCHANGE_MODE_TONE.GIFT, matches: (item) => item.mode === "GIFT" && item.reservation === null },
  { key: "SWAP", label: INTENT_LABELS.SWAP, tone: EXCHANGE_MODE_TONE.SWAP, matches: (item) => item.mode === "SWAP" && item.reservation === null },
  { key: "RESERVED", label: "Zarezerwowane", tone: "bg-teal-soft text-ink", matches: (item) => item.reservation !== null },
];

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isExchangeCountsEmpty(data: OrganizerPageData): boolean {
  const counts = data.directory?.exchange.counts;
  return !counts || exchangeTotal(counts) === 0;
}

/** "N Chcę oddać · N Chcę się zamienić · N Zarezerwowane", each tile leading
 * to a term where such an item is listed. Shared by this block and the
 * EXCHANGE board. */
export function ExchangeCountTiles({ exchange, slug }: { exchange: OrganizerPageResponse["exchange"]; slug: string }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {COUNT_TILES.map(({ key, label, tone, matches }) => {
        const count = exchange.counts[key];
        const first = count > 0 ? exchange.items.find(matches) : undefined;
        const className = `flex min-h-[72px] flex-col items-center justify-center rounded-2xl px-2 py-3 text-center ${tone}`;
        const content = (
          <>
            <span className="text-xl font-extrabold">{count}</span>{" "}
            <span className="text-[12px] font-bold">{label}</span>
          </>
        );
        return first ? (
          <Link
            key={key}
            to={organizerTermPath(slug, first.group_id, first.term_id)}
            className={`${className} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`}
          >
            {content}
          </Link>
        ) : (
          <div key={key} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

/** `tiles3`: the count tiles under a "Wymiana rzeczy" heading. */
export function ExchangeCountsBlock({ data }: BlockProps) {
  const exchange = data.directory?.exchange;
  if (!exchange) return null;

  return (
    <section className="px-6 pt-6">
      <h2 className="mb-3 font-serif text-xl font-semibold text-ink">Wymiana rzeczy</h2>
      <ExchangeCountTiles exchange={exchange} slug={data.organization.slug} />
    </section>
  );
}
