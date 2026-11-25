import type { ReactNode } from "react";
import type { SearchMode } from "../../api/search";
import { Skeleton } from "../../components/shared/Skeleton";
import { SearchResultsSkeleton } from "../search/SearchSkeleton";

/** The location card's place while the page loads. */
function LocationCardSkeleton() {
  return (
    <div className="flex h-full min-h-24 flex-col gap-3 rounded-[22px] border border-line bg-paper p-4 md:min-h-72 md:rounded-4xl md:p-7">
      <Skeleton className="h-12 w-12 rounded-full md:h-19 md:w-19" />
      <Skeleton className="h-5 w-3/4 rounded-md md:h-6" />
      <Skeleton className="hidden h-3.5 w-full rounded-md md:block" />
      <Skeleton className="mt-auto hidden h-11 w-44 rounded-full md:block" />
    </div>
  );
}

function SectionSkeleton({ mode }: { mode: SearchMode }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2.5">
        <Skeleton className="h-6 w-48 rounded-lg @3xl:h-8 @3xl:w-64" />
        <Skeleton className="h-3.5 w-28 rounded-md" />
      </div>
      <SearchResultsSkeleton mode={mode} />
    </div>
  );
}

/** `HomeFeed` while the page loads: the location card (or what `top` puts
 * around it) and both sections, in the feed's own grids. */
export function HomeFeedSkeleton({ top }: { top?: (location: ReactNode) => ReactNode }) {
  const location = <LocationCardSkeleton />;
  return (
    <div aria-busy="true" className="@container flex flex-col gap-9 md:gap-12">
      <span className="sr-only">Wczytywanie…</span>
      {top ? top(location) : location}
      <SectionSkeleton mode="items" />
      <SectionSkeleton mode="events" />
    </div>
  );
}

/** The landing page while it loads: the hero's place beside the location
 * card, then the feed. */
export function LandingPageSkeleton() {
  return (
    <div className="flex-1 bg-cream font-sans">
      <div className="mx-auto flex w-full max-w-300 flex-col px-4 pt-4 pb-12 md:px-6 md:pt-7">
        <HomeFeedSkeleton
          top={(location) => (
            <div className="flex flex-col gap-7 md:flex-row md:items-stretch md:gap-6">
              <div className="h-64 rounded-[28px] bg-primary/25 md:h-auto md:min-h-88 md:flex-[1.4] md:rounded-4xl" />
              <div className="md:w-95 md:flex-none">{location}</div>
            </div>
          )}
        />
      </div>
    </div>
  );
}
