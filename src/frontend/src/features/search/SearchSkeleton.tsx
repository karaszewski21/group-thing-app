import type { SearchMode } from "../../api/search";
import { Skeleton } from "../../components/shared/Skeleton";

/** Result placeholders while a search loads: item tiles in two columns, or
 * meeting rows. Decorative; the panel's „Szukam…” announces the wait. */
export function SearchResultsSkeleton({ mode }: { mode: SearchMode }) {
  if (mode === "items") {
    return (
      <div aria-hidden="true" className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="flex flex-col gap-2 rounded-2xl border border-line bg-paper p-2.5">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <Skeleton className="h-3.5 w-4/5 rounded-md" />
            <Skeleton className="h-3 w-1/2 rounded-md" />
            <Skeleton className="h-5.5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="flex flex-col gap-2.5">
      {["w-3/5", "w-1/2", "w-[58%]"].map((width) => (
        <div key={width} className="flex gap-3 rounded-2xl border border-line bg-paper p-3">
          <Skeleton className="h-11.5 w-11.5 shrink-0 rounded-[13px]" />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <Skeleton className="h-2.5 w-16 rounded-md" />
            <Skeleton className={`h-3.5 rounded-md ${width}`} />
            <Skeleton className="h-3 w-[45%] rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The /search page before it renders: the field, the mode tabs, the scope
 * toggle and the filters as bars, then item tiles. */
export function SearchPageSkeleton() {
  return (
    <div aria-busy="true" className="font-sans">
      <span className="sr-only">Wczytywanie...</span>
      <Skeleton className="mb-3 h-12.5 rounded-full" />
      <Skeleton className="mb-2 h-13 rounded-full" />
      <Skeleton className="mb-3 h-13 rounded-full" />
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
