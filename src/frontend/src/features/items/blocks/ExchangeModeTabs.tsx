import { useRef, type KeyboardEvent } from "react";
import type { ExchangeMode } from "../../../api/groups";
import { nextIndex } from "../../../components/shared/rovingIndex";
import { exchangeTotal } from "../../organization-public/organizerHelpers";
import { EXCHANGE_MODE_TONE, INTENT_LABELS } from "../../terms/components/termLabels";

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
