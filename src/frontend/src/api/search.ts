import { api } from "./client";
import type { ExchangeMode } from "./groups";
import type { ItemCondition } from "./inventories";
import { pageParams, type Page } from "./pagination";

/** `items` searches offered items, `events` the meetings (terms, events,
 * groups and organizations, in one list). */
export type SearchMode = "items" | "events";
/** `mine` keeps to the viewer's groups; a guest always gets `all`. */
export type SearchScope = "mine" | "all";

/** The per-mode filters: `category`, `condition` and `offer_type` apply to
 * items only, `date_from` and `date_to` (ISO dates) to meetings only. */
export interface SearchFilters {
  category: string | null;
  condition: ItemCondition | null;
  offer_type: ExchangeMode | null;
  date_from: string | null;
  date_to: string | null;
}

export interface SearchQuery {
  q: string;
  mode: SearchMode;
  scope: SearchScope;
  filters: SearchFilters;
}

interface SearchResultBase {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface ProductSearchResult extends SearchResultBase {
  kind: "product";
  meta: {
    mode: ExchangeMode;
    condition: ItemCondition;
    thumb_url: string | null;
    reserved: boolean;
    /** The term's or event's start of the newest open reservation; `null`
     * for a personal pickup, a pending swap proposal or an available item. */
    reserved_until: string | null;
  };
}

export interface TermSearchResult extends SearchResultBase {
  kind: "term";
  meta: { starts_at: string; place: string | null; in_my_groups: boolean };
}

export interface EventSearchResult extends SearchResultBase {
  kind: "event";
  meta: { starts_at: string; place: string | null };
}

export interface GroupSearchResult extends SearchResultBase {
  kind: "group";
  /** `next_starts_at` is set when `href` is the group's nearest upcoming term. */
  meta: { description: string | null; next_starts_at: string | null; in_my_groups: boolean };
}

export interface OrganizationSearchResult extends SearchResultBase {
  kind: "organization";
  meta: { slug: string };
}

export type SearchResult =
  | ProductSearchResult
  | TermSearchResult
  | EventSearchResult
  | GroupSearchResult
  | OrganizationSearchResult;

/** One page of one mode, plus how many results the other mode has for the
 * same `q` and scope, without filters. */
export interface SearchPage extends Page<SearchResult> {
  other_mode_count: number;
}

/** `GET /api/public/search`: only the filters of the searched mode are sent. */
export function searchPublic({ q, mode, scope, filters }: SearchQuery, page: number, size?: number): Promise<SearchPage> {
  const params = new URLSearchParams({ q, mode, scope });
  const modeFilters =
    mode === "items"
      ? { category: filters.category, condition: filters.condition, offer_type: filters.offer_type }
      : { date_from: filters.date_from, date_to: filters.date_to };
  for (const [key, value] of Object.entries(modeFilters)) {
    if (value) params.set(key, value);
  }
  for (const [key, value] of pageParams(page, size)) params.set(key, value);
  return api.get(`/public/search?${params}`);
}
