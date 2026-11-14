import type { SearchFilters, SearchMode, SearchScope } from "../../api/search";
import { useCategories } from "../../hooks/useCategories";

/** How many refinements the „Filtry” sheet has set. A main category is
 * picked from the tiles, so only a subcategory counts. */
export function useRefinementCount(mode: SearchMode, filters: SearchFilters, scope: SearchScope | null): number {
  const { data } = useCategories();
  const subcategory = data.some((category) => category.id === filters.category && category.parent_id !== null);
  const set =
    mode === "items"
      ? [scope === "mine", filters.locality, subcategory, filters.condition, filters.offer_type]
      : [scope === "mine", filters.locality, filters.date_from, filters.date_to];
  return set.filter(Boolean).length;
}
