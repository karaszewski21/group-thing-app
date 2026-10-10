import { Link } from "react-router-dom";
import type { ExchangeMode } from "../../../api/groups";
import { EXCHANGE_MODE_LABELS, EXCHANGE_MODE_TONE } from "../../krag/components/termLabels";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { exchangeTotal, organizerTermPath } from "../organizerHelpers";

const EXCHANGE_MODES = Object.keys(EXCHANGE_MODE_LABELS) as ExchangeMode[];

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isExchangeCountsEmpty(data: OrganizerPageData): boolean {
  const counts = data.directory?.exchange.counts;
  return !counts || exchangeTotal(counts) === 0;
}

/** `tiles3`: how many items are offered per mode, each tile leading to a term
 * where such an item is listed. */
export function ExchangeCountsBlock({ data }: BlockProps) {
  const exchange = data.directory?.exchange;
  if (!exchange) return null;
  const slug = data.organization.slug;

  return (
    <section className="px-6 pt-6">
      <h2 className="mb-3 font-serif text-xl font-semibold text-ink">Wymiana rzeczy</h2>
      <div className="grid grid-cols-3 gap-2">
        {EXCHANGE_MODES.map((mode) => {
          const count = exchange.counts[mode];
          const first = count > 0 ? exchange.items.find((item) => item.mode === mode) : undefined;
          const className = `flex min-h-[72px] flex-col items-center justify-center rounded-2xl px-2 py-3 text-center ${EXCHANGE_MODE_TONE[mode]}`;
          const content = (
            <>
              <span className="text-[12px] font-bold">{EXCHANGE_MODE_LABELS[mode]}</span>
              <span className="text-xl font-extrabold">{count}</span>
            </>
          );
          return first ? (
            <Link
              key={mode}
              to={organizerTermPath(slug, first.group_id, first.term_id)}
              className={`${className} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`}
            >
              {content}
            </Link>
          ) : (
            <div key={mode} className={className}>
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
