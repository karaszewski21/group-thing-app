import { Skeleton } from "../../components/shared/Skeleton";

/** The panel while its data loads: the title, a hint card, a section heading
 * and three list cards. The bottom tab bar is drawn by the caller. */
export function AppSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Wczytywanie…</span>
      <Skeleton className="h-9 w-50 rounded-xl" />
      <Skeleton className="-mt-1.5 h-3.5 w-35 rounded-md" />
      <div className="flex items-center gap-3 rounded-[22px] border border-line bg-paper p-4">
        <Skeleton className="h-11 w-11 shrink-0 rounded-[14px]" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-[70%] rounded-md" />
          <Skeleton className="h-3 w-[90%] rounded-md" />
        </div>
      </div>
      <Skeleton className="mt-1 h-5 w-38 rounded-lg" />
      {["w-[72%]", "w-[58%]", "w-[66%]"].map((width) => (
        <div key={width} className="flex items-center gap-3.5 rounded-[22px] border border-line bg-paper p-3.5">
          <Skeleton className="h-15 w-13.5 shrink-0 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className={`h-4 rounded-lg ${width}`} />
            <Skeleton className="h-3 w-1/2 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
