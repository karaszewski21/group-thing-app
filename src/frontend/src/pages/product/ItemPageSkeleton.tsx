import { Skeleton } from "../../components/shared/Skeleton";
import { ItemBackButton } from "./ItemBackButton";

/** The item page while its details load: the photo area, then the sheet with
 * the name, chips, status card and description. Runs inside the organizer's
 * theme, so the photo area already takes their palette. */
export function ItemPageSkeleton() {
  return (
    <div aria-busy="true" className="relative">
      <span className="sr-only">Wczytywanie rzeczy…</span>
      <Skeleton tone="primary" className="aspect-4/3 w-full" />
      <div className="absolute top-4 left-4">
        <ItemBackButton overlay />
      </div>
      <div className="relative -mt-6 flex flex-col gap-3.5 rounded-t-[28px] bg-cream px-5 pt-5.5">
        <Skeleton className="h-7.5 w-56 rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-6.5 w-22 rounded-full" />
          <Skeleton className="h-6.5 w-18 rounded-full" />
        </div>
        <div className="flex items-center gap-3 rounded-[22px] border border-line bg-paper p-4">
          <Skeleton tone="primary" className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-[55%] rounded-md" />
            <Skeleton className="h-3 w-4/5 rounded-md" />
          </div>
        </div>
        <Skeleton className="mt-1.5 h-4.5 w-22 rounded-lg" />
        <Skeleton className="h-3 w-full rounded-md" />
        <Skeleton className="h-3 w-[92%] rounded-md" />
        <Skeleton className="h-3 w-3/5 rounded-md" />
      </div>
    </div>
  );
}
