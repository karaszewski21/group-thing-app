"use client";

import { useId } from "react";
import { itemPagePath } from "../../product/useItemRoutes";
import { ExchangeModeTabs, type ExchangeFilter } from "../../owner-page/blocks/ExchangeBoardBlock";
import { ItemCard } from "../../owner-page/blocks/ExchangeItemCard";
import { useOwnerItemsPage } from "../OwnerItemsContext";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const RETRY_BUTTON = `min-h-[44px] font-bold text-primary-fg underline ${FOCUS_RING}`;
const MORE_BUTTON = `flex min-h-11 w-full items-center justify-center rounded-full border border-line bg-paper px-5 text-[14px] font-bold text-ink disabled:opacity-60 ${FOCUS_RING}`;

/** The mode tabs (when there is anything listed) over the paged card grid,
 * each tile linking to its product page. */
export function OwnerItemsList() {
  const { owner, counts, items, filter, setFilter } = useOwnerItemsPage();
  const baseId = useId();
  const hasItems = counts.GIFT + counts.SWAP > 0;
  const tabId = (id: ExchangeFilter) => `${baseId}-tab-${id}`;
  const panelId = `${baseId}-items`;
  return (
    <>
      {hasItems && (
        <div className="px-6 pt-4">
          <ExchangeModeTabs
            counts={counts}
            selected={filter}
            onSelect={(next) => {
              if (next !== "RESERVED") setFilter(next);
            }}
            allLabel="Wszystkie"
            ariaLabel="Rodzaj wymiany"
            tabId={tabId}
            panelId={panelId}
          />
        </div>
      )}
      <div
        role={hasItems ? "tabpanel" : undefined}
        id={panelId}
        aria-labelledby={hasItems ? tabId(filter) : undefined}
        className="flex flex-col gap-3 px-6 pt-3"
      >
        {items.items.length === 0 ? (
          <p className="text-[13px] text-ink-soft">Nie ma teraz rzeczy do oddania ani zamiany.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2.5">
            {items.items.map((item) => (
              <li key={item.item_id}>
                <ItemCard
                  href={itemPagePath(owner.slug ?? owner.party_id, item.item_id)}
                  name={item.product_name}
                  condition={item.condition}
                  thumbUrl={item.thumb_url}
                  mode={item.mode}
                  reservation={item.reservation}
                />
              </li>
            ))}
          </ul>
        )}
        {items.nextPageError ? (
          <p className="text-[13px] text-ink-soft">
            Nie udało się wczytać kolejnych rzeczy.{" "}
            <button type="button" onClick={() => void items.fetchNextPage()} className={RETRY_BUTTON}>
              Spróbuj ponownie
            </button>
          </p>
        ) : (
          items.hasNextPage && (
            <button
              type="button"
              onClick={() => void items.fetchNextPage()}
              disabled={items.fetchingNextPage}
              className={MORE_BUTTON}
            >
              {items.fetchingNextPage ? "Wczytywanie…" : "Pokaż więcej"}
            </button>
          )
        )}
      </div>
    </>
  );
}
