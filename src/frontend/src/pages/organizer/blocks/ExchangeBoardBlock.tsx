import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { ExchangeMode, OrganizerExchangeItem } from "../../../api/groups";
import { EXCHANGE_MODE_TONE, INTENT_LABELS } from "../../term/components/termLabels";
import { nextIndex } from "../editor/rovingIndex";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { exchangeTotal } from "../organizerHelpers";
import { ExchangeCountTiles } from "./ExchangeCountsBlock";
import { ExchangeItemCard } from "./ExchangeItemCard";

export type ExchangeFilter = "ALL" | ExchangeMode | "RESERVED";

const MODES = Object.keys(INTENT_LABELS) as ExchangeMode[];

interface ExchangeModeTabsProps {
  /** With `RESERVED` (the organizer board) the mode counts are available-only
   * and a "Zarezerwowane" tab follows; without it they include reserved items. */
  counts: Record<ExchangeMode, number> & { RESERVED?: number };
  selected: ExchangeFilter;
  onSelect: (filter: ExchangeFilter) => void;
  /** The unfiltered tab's label, e.g. "Wszystkie". */
  allLabel: string;
  ariaLabel: string;
  tabId: (filter: ExchangeFilter) => string;
  panelId: string;
}

/** Wszystkie / Chcę oddać / Chcę się zamienić (/ Zarezerwowane) tabs with
 * counts; empty ones are disabled and the arrow keys move between the
 * enabled ones. The strip wraps so every tab stays visible on a phone. */
export function ExchangeModeTabs({ counts, selected, onSelect, allLabel, ariaLabel, tabId, panelId }: ExchangeModeTabsProps) {
  const tabRefs = useRef<Partial<Record<ExchangeFilter, HTMLButtonElement | null>>>({});
  const tabs: { id: ExchangeFilter; label: string; count: number; tone: string }[] = [
    { id: "ALL", label: allLabel, count: exchangeTotal(counts), tone: "bg-cream text-ink" },
    ...MODES.map((mode) => ({
      id: mode,
      label: INTENT_LABELS[mode],
      count: counts[mode],
      tone: EXCHANGE_MODE_TONE[mode],
    })),
    ...(counts.RESERVED === undefined
      ? []
      : [{ id: "RESERVED" as const, label: "Zarezerwowane", count: counts.RESERVED, tone: "bg-teal-soft text-ink" }]),
  ];
  const enabled = tabs.filter((tab) => tab.count > 0);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = nextIndex(event.key, enabled.findIndex((tab) => tab.id === selected), enabled.length, "horizontal");
    if (index === null) return;
    event.preventDefault();
    const target = enabled[index].id;
    onSelect(target);
    tabRefs.current[target]?.focus();
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => {
        const on = tab.id === selected;
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
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            disabled={tab.count === 0}
            onClick={() => onSelect(tab.id)}
            onKeyDown={handleKeyDown}
            className={`min-h-[44px] whitespace-nowrap rounded-full px-4 text-[13px] font-extrabold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
              on ? "bg-ink text-on-ink" : tab.tone
            }`}
          >
            {tab.label} {tab.count}
          </button>
        );
      })}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isExchangeBoardEmpty(data: OrganizerPageData): boolean {
  return (data.directory?.exchange.items.length ?? 0) === 0;
}

/** One board tab's items, matching the counts: a mode tab holds only the
 * available items of that mode, "Zarezerwowane" every reserved one. */
function matchesFilter(item: OrganizerExchangeItem, filter: ExchangeFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "RESERVED") return item.reservation !== null;
  return item.mode === filter && item.reservation === null;
}

/** `grid2`: the count tiles, then the exchange items as a 2-column board with
 * tabs that filter it on the client. Tab counts cover every item, the board
 * only the capped list. */
export function ExchangeBoardBlock({ data }: BlockProps) {
  const [filter, setFilter] = useState<ExchangeFilter>("ALL");
  const baseId = useId();
  const exchange = data.directory?.exchange;
  if (!exchange) return null;

  const { counts, items } = exchange;
  const shown = items.filter((item) => matchesFilter(item, filter));
  const tabId = (id: ExchangeFilter) => `${baseId}-tab-${id}`;
  const boardId = `${baseId}-board`;

  return (
    <section className="px-6 pt-5">
      <ExchangeCountTiles exchange={exchange} slug={data.organization.slug} />
      <div className="mt-3">
        <ExchangeModeTabs
          counts={counts}
          selected={filter}
          onSelect={setFilter}
          allLabel="Wszystkie"
          ariaLabel="Wymiana rzeczy"
          tabId={tabId}
          panelId={boardId}
        />
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
