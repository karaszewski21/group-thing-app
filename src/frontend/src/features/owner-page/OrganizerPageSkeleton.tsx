import { Skeleton, SkeletonCard } from "../../components/shared/Skeleton";
import { PageFrame } from "./PageFrame";

/** The organizer page before the organization loads. Its layout and palette
 * come with that data, so this is one neutral shape for every layout: a
 * pulsing cover, the name and three cards. */
export function OrganizerPageSkeleton() {
  return (
    <PageFrame className="font-sans">
      <div aria-busy="true" className="flex flex-col">
        <span className="sr-only">Wczytywanie…</span>
        <Skeleton className="h-55 rounded-b-[34px]" />
        <div className="flex flex-col items-center gap-3 px-6 pt-6">
          <Skeleton className="h-7 w-52 rounded-xl" />
          <Skeleton className="h-3.5 w-36 rounded-md" />
        </div>
        <div className="flex flex-col gap-3 px-5 pt-8 pb-6">
          <SkeletonCard titleWidth="w-1/2" />
          <SkeletonCard titleWidth="w-1/3" />
          <SkeletonCard titleWidth="w-2/5" />
        </div>
      </div>
    </PageFrame>
  );
}
