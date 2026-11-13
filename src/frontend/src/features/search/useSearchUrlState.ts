import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ExchangeMode } from "../../api/groups";
import type { ItemCondition } from "../../api/inventories";
import type { SearchFilters, SearchMode, SearchScope } from "../../api/search";
import { useAppSearchParams } from "../../routing/navigation";

const CONDITIONS: readonly ItemCondition[] = ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"];
const OFFER_TYPES: readonly ExchangeMode[] = ["GIFT", "SWAP"];
const FILTER_KEYS = ["category", "condition", "offer_type", "date_from", "date_to"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

function isoDate(value: string | null): string | null {
  return value !== null && ISO_DATE.test(value) ? value : null;
}

export interface SearchUrlState {
  /** The typed `q`, untrimmed (it feeds the input). */
  q: string;
  mode: SearchMode;
  /** Always `all` for a guest. */
  scope: SearchScope;
  /** Only the searched mode's filters; the other mode's are `null`. */
  filters: SearchFilters;
  /** Typing: replaces the history entry. */
  setQ: (q: string) => void;
  /** Keeps `q` and the scope, clears every filter. */
  setMode: (mode: SearchMode) => void;
  /** Ignored for a guest. */
  setScope: (scope: SearchScope) => void;
  setFilters: (patch: Partial<SearchFilters>) => void;
  /** Meetings: an explicit „Do” earlier than „Od”; nothing is searched. */
  dateRangeInvalid: boolean;
}

/** The search state held in the URL (`q, mode, scope, category, condition,
 * offer_type, date_from, date_to`), so going back from a result card
 * restores the results. Defaults (`items`, `all`) are left out of the URL;
 * a guest's scope is never written, and one already there is dropped. */
export function useSearchUrlState(guest: boolean): SearchUrlState {
  const [params, setParams] = useAppSearchParams();

  const q = params.get("q") ?? "";
  const mode: SearchMode = params.get("mode") === "events" ? "events" : "items";
  const scope: SearchScope = !guest && params.get("scope") === "mine" ? "mine" : "all";
  const category = params.get("category");
  const condition = params.get("condition");
  const offerType = params.get("offer_type");
  const dateFrom = params.get("date_from");
  const dateTo = params.get("date_to");
  const filters = useMemo<SearchFilters>(
    () =>
      mode === "items"
        ? {
            category: category || null,
            condition: oneOf(CONDITIONS, condition),
            offer_type: oneOf(OFFER_TYPES, offerType),
            date_from: null,
            date_to: null,
          }
        : { category: null, condition: null, offer_type: null, date_from: isoDate(dateFrom), date_to: isoDate(dateTo) },
    [mode, category, condition, offerType, dateFrom, dateTo],
  );

  // Each write starts from the previous write, not the last render's params,
  // so two changes before the re-render both land.
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  }, [params]);

  const update = useCallback(
    (change: (next: URLSearchParams) => void, replace = false) => {
      const next = new URLSearchParams(latest.current);
      change(next);
      if (guest) next.delete("scope");
      latest.current = next;
      setParams(next, { replace });
    },
    [setParams, guest],
  );

  const strayScope = guest ? params.has("scope") : params.has("scope") && params.get("scope") !== "mine";
  useEffect(() => {
    if (strayScope) update((next) => next.delete("scope"), true);
  }, [strayScope, update]);

  const setQ = useCallback(
    (value: string) =>
      update((next) => {
        if (value) next.set("q", value);
        else next.delete("q");
      }, true),
    [update],
  );
  const setMode = useCallback(
    (value: SearchMode) =>
      update((next) => {
        for (const key of FILTER_KEYS) next.delete(key);
        if (value === "items") next.delete("mode");
        else next.set("mode", value);
      }),
    [update],
  );
  const setScope = useCallback(
    (value: SearchScope) => {
      if (guest) return;
      update((next) => {
        if (value === "mine") next.set("scope", value);
        else next.delete("scope");
      });
    },
    [update, guest],
  );
  const setFilters = useCallback(
    (patch: Partial<SearchFilters>) =>
      update((next) => {
        for (const key of FILTER_KEYS) {
          if (!(key in patch)) continue;
          const value = patch[key];
          if (value) next.set(key, value);
          else next.delete(key);
        }
      }),
    [update],
  );

  const dateRangeInvalid =
    filters.date_from !== null && filters.date_to !== null && filters.date_to < filters.date_from;

  return { q, mode, scope, filters, setQ, setMode, setScope, setFilters, dateRangeInvalid };
}
