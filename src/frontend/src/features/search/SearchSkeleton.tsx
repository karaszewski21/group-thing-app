import type { SearchMode } from "../../api/search";
import { Skeleton } from "../../components/shared/Skeleton";

/** The /search page column inside the app layout: the app's full width on a wide screen. */
export const SEARCH_PAGE_CLASS = "@container mx-auto w-full max-w-300 px-4 pt-4 pb-8 font-sans text-ink md:px-6 md:pt-6 md:pb-10";

/** The item results grid: two columns on a phone, up to four on a wide screen. */
export const ITEM_GRID_CLASS = "grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @3xl:gap-4";
/** The meeting results list: one column, two on a wide screen. */
export const MEETING_LIST_CLASS = "flex flex-col gap-2.5 @3xl:grid @3xl:grid-cols-2 @3xl:gap-3";

const SKELETON_COUNT: Record<SearchMode, number> = { items: 8, events: 4 };
const TITLE_WIDTHS = ["w-4/5", "w-3/5", "w-[70%]", "w-1/2"];

/** One `ItemCard` while it loads: the photo with its badge's place, two
 * lines of name and the condition. */
function ItemTileSkeleton({ index }: { index: number }) {
  return (
    <div className="flex flex-col rounded-[20px] border border-line bg-paper p-2 md:rounded-[22px] md:p-2.5">
      <div className="relative">
        <Skeleton className="aspect-square w-full rounded-[14px] md:rounded-2xl" />
        <span className="absolute top-1.5 left-1.5 h-5 w-14 rounded-full bg-paper/70 md:top-2 md:left-2 md:h-6 md:w-16" />
      </div>
      <Skeleton className={`mt-2.5 h-3.5 rounded-md md:mt-3 md:h-4 ${TITLE_WIDTHS[index % TITLE_WIDTHS.length]}`} />
      <Skeleton className="mt-2 h-3 w-2/5 rounded-md" />
    </div>
  );
}

/** One meeting tile while it loads: the calendar leaf and three lines. */
function MeetingTileSkeleton({ index }: { index: number }) {
  return (
    <div className="flex gap-3.5 rounded-[22px] border border-line bg-paper p-3.5 md:gap-4 md:p-4">
      <Skeleton className="h-16 w-14 shrink-0 rounded-2xl md:h-17 md:w-16" />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <Skeleton className="h-2.5 w-16 rounded-md" />
        <Skeleton className={`h-4 rounded-md ${TITLE_WIDTHS[index % TITLE_WIDTHS.length]}`} />
        <Skeleton className="h-3 w-[45%] rounded-md" />
      </div>
    </div>
  );
}

/** Result placeholders in the results' own grid, shaped like the tiles that
 * replace them: `count` item tiles or meeting tiles (by default 8 and 4).
 * Decorative; the page announces the wait. */
export function SearchResultsSkeleton({ mode, count = SKELETON_COUNT[mode] }: { mode: SearchMode; count?: number }) {
  const keys = Array.from({ length: count }, (_, index) => index);
  if (mode === "items") {
    return (
      <div aria-hidden="true" className={ITEM_GRID_CLASS}>
        {keys.map((index) => (
          <ItemTileSkeleton key={index} index={index} />
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden="true" className={MEETING_LIST_CLASS}>
      {keys.map((index) => (
        <MeetingTileSkeleton key={index} index={index} />
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
