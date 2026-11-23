import type { SearchMode } from "../../api/search";
import { Skeleton } from "../../components/shared/Skeleton";

/** The /search page column inside the app layout: the app's full width on a wide screen. */
export const SEARCH_PAGE_CLASS = "mx-auto w-full max-w-300 px-4 pt-4 pb-8 font-sans text-ink md:px-6 md:pt-6 md:pb-10";

/** The item results grid: two columns on a phone, up to four on a wide screen. */
export const ITEM_GRID_CLASS = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4";
/** The meeting results list: one column, two on a wide screen. */
export const MEETING_LIST_CLASS = "flex flex-col gap-2.5 lg:grid lg:grid-cols-2 lg:gap-3";

/** Result placeholders while a search loads: item tiles in the grid, or
 * meeting tiles. Decorative; the panel's „Szukam…” announces the wait. */
export function SearchResultsSkeleton({ mode }: { mode: SearchMode }) {
  if (mode === "items") {
    return (
      <div aria-hidden="true" className={ITEM_GRID_CLASS}>
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="flex flex-col gap-2 rounded-[22px] border border-line bg-paper p-2.5">
            <Skeleton className="aspect-square w-full rounded-2xl" />
            <Skeleton className="h-4 w-4/5 rounded-md" />
            <Skeleton className="h-3 w-1/2 rounded-md" />
            <Skeleton className="h-5.5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden="true" className={MEETING_LIST_CLASS}>
      {["w-3/5", "w-1/2", "w-[58%]"].map((width) => (
        <div key={width} className="flex gap-3.5 rounded-[22px] border border-line bg-paper p-3.5">
          <Skeleton className="h-16 w-14 shrink-0 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-2.5 w-16 rounded-md" />
            <Skeleton className={`h-4 rounded-md ${width}`} />
            <Skeleton className="h-3 w-[45%] rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The /search page before it renders: the field and the mode tabs, the
 * category tiles, then item tiles. */
export function SearchPageSkeleton() {
  return (
    <div aria-busy="true" className={SEARCH_PAGE_CLASS}>
      <span className="sr-only">Wczytywanie...</span>
      <Skeleton className="mb-4 hidden h-10 w-40 rounded-lg md:block" />
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:gap-4">
        <Skeleton className="h-12.5 flex-1 rounded-full md:h-14" />
        <Skeleton className="h-13 rounded-full md:w-90" />
      </div>
      <div className="mb-3 flex gap-2">
        <Skeleton className="h-10 w-28 rounded-full" />
        <Skeleton className="h-10 w-20 rounded-full" />
        <Skeleton className="h-10 w-24 rounded-full" />
      </div>
      <Skeleton className="mb-3 h-4 w-40 rounded-lg" />
      <SearchResultsSkeleton mode="items" />
    </div>
  );
}
