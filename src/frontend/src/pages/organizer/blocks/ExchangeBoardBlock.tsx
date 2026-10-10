import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { ExchangeMode } from "../../../api/groups";
import { EXCHANGE_MODE_LABELS, EXCHANGE_MODE_TONE } from "../../krag/components/termLabels";
import { nextIndex } from "../editor/rovingIndex";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { exchangeTotal } from "../organizerHelpers";
import { ExchangeItemCard } from "./ExchangeItemCard";

type Filter = "ALL" | ExchangeMode;

const MODES = Object.keys(EXCHANGE_MODE_LABELS) as ExchangeMode[];

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isExchangeBoardEmpty(data: OrganizerPageData): boolean {
  return (data.directory?.exchange.items.length ?? 0) === 0;
}

/** `grid2`: the exchange items as a 2-column board with mode tabs that filter
 * it on the client. Tab counts cover every item, the board only the capped list. */
export function ExchangeBoardBlock({ data }: BlockProps) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const tabRefs = useRef<Partial<Record<Filter, HTMLButtonElement | null>>>({});
  const baseId = useId();
  const exchange = data.directory?.exchange;
  if (!exchange) return null;

  const { counts, items } = exchange;
  const tabs: { id: Filter; label: string; count: number; tone: string }[] = [
    { id: "ALL", label: "Wszystko", count: exchangeTotal(counts), tone: "bg-cream text-ink" },
    ...MODES.map((mode) => ({
      id: mode,
      label: EXCHANGE_MODE_LABELS[mode],
      count: counts[mode],
      tone: EXCHANGE_MODE_TONE[mode],
    })),
  ];
  const enabled = tabs.filter((tab) => tab.count > 0);
  const shown = filter === "ALL" ? items : items.filter((item) => item.mode === filter);
  const tabId = (id: Filter) => `${baseId}-tab-${id}`;
  const boardId = `${baseId}-board`;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = nextIndex(event.key, enabled.findIndex((tab) => tab.id === filter), enabled.length, "horizontal");
    if (index === null) return;
    event.preventDefault();
    const target = enabled[index].id;
    setFilter(target);
    tabRefs.current[target]?.focus();
  }

  return (
    <section className="px-6 pt-5">
      <div role="tablist" aria-label="Wymiana rzeczy" className="-mx-6 flex snap-x scroll-px-6 gap-1.5 overflow-x-auto px-6 pb-1">
        {tabs.map((tab) => {
          const on = tab.id === filter;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[tab.id] = element;
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={on}
              aria-controls={boardId}
              tabIndex={on ? 0 : -1}
              disabled={tab.count === 0}
              onClick={() => setFilter(tab.id)}
              onKeyDown={handleKeyDown}
              className={`min-h-[44px] shrink-0 snap-start whitespace-nowrap rounded-full px-4 text-[13px] font-extrabold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                on ? "bg-ink text-on-ink" : tab.tone
              }`}
            >
              {tab.label} {tab.count}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={boardId} aria-labelledby={tabId(filter)} className="mt-3">
        {shown.length > 0 ? (
          <ul className="grid grid-cols-2 gap-2.5">
            {shown.map((item) => (
              <li key={item.item_id}>
                <ExchangeItemCard slug={data.organization.slug} item={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-soft">Te rzeczy zobaczysz na stronach najbliższych terminów.</p>
        )}
      </div>
    </section>
  );
}
