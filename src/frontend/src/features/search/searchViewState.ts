import type { SearchMode, SearchResult, SearchScope } from "../../api/search";

/** The one screen of `/search` under the filters. */
export type SearchViewState =
  | { kind: "hint" }
  /** „Do” before „Od”: nothing is asked for; the error sits at the input. */
  | { kind: "invalid-range" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty-items"; q: string; scope: SearchScope; otherModeCount: number }
  | { kind: "empty-meetings"; q: string; otherModeCount: number }
  | {
      kind: "results";
      items: SearchResult[];
      total: number;
      otherModeCount: number;
      /** The results belong to an earlier `q` or filter set; a new one loads. */
      stale: boolean;
      /** A refetch failed; the results shown are the last loaded ones. */
      refreshError: string | null;
    };

export interface SearchViewInput {
  /** The trimmed typed `q`. */
  q: string;
  mode: SearchMode;
  /** The effective scope (`all` for a guest). */
  scope: SearchScope;
  tooShort: boolean;
  /** The meetings date range is inverted (`useSearchUrlState`). */
  dateRangeInvalid: boolean;
  loading: boolean;
  stale: boolean;
  error: string | null;
  items: SearchResult[];
  total: number;
  otherModeCount: number;
}

/** First match wins: under 2 characters the hint (nothing is asked for),
 * then an inverted date range (nothing is asked for either), then the first page loading or failing, then empty or the results. An old
 * empty list is not shown as "nothing found" for a new `q`. */
export function resolveSearchView(state: SearchViewInput): SearchViewState {
  const { q, mode, scope, items, total, otherModeCount, stale, error } = state;
  if (state.tooShort) return { kind: "hint" };
  if (state.dateRangeInvalid) return { kind: "invalid-range" };
  if (state.loading) return { kind: "loading" };
  if (items.length === 0) {
    if (error) return { kind: "error", message: error };
    if (stale) return { kind: "loading" };
    return mode === "items"
      ? { kind: "empty-items", q, scope, otherModeCount }
      : { kind: "empty-meetings", q, otherModeCount };
  }
  return { kind: "results", items, total, otherModeCount, stale, refreshError: error };
}
