import { Skeleton } from "../../../components/shared/Skeleton";

/** The term page while its data loads. The layout (krąg / boisko / stół) and
 * the organizer's palette are not known yet, so the visualization is one
 * neutral box and everything stays in the app's own colors. */
export function TermPageSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-1 flex-col bg-cream font-sans">
      <span className="sr-only">Wczytywanie...</span>
      <div className="flex flex-col gap-3.5 px-5 pt-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-9 w-40 rounded-full" />
        </div>
        <Skeleton className="h-9 w-60 rounded-xl" />
        <Skeleton className="h-4 w-44 rounded-lg" />
      </div>

      <Skeleton className="mx-5 mt-4.5 h-82 rounded-[30px]" />

      <div className="mx-5 mt-4 flex items-center gap-3.5 rounded-[22px] border border-line bg-paper p-3.5">
        <Skeleton className="h-15 w-13.5 shrink-0 rounded-2xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-[70%] rounded-lg" />
          <Skeleton className="h-3 w-2/5 rounded-md" />
        </div>
      </div>

      <div className="mx-5 mt-6 flex flex-col gap-3">
        <Skeleton className="h-5.5 w-48 rounded-lg" />
        <div className="divide-y divide-line rounded-[22px] border border-line bg-paper px-3.5">
          {["w-3/5", "w-1/2", "w-[58%]"].map((width) => (
            <div key={width} className="flex items-center gap-3 py-2.5">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className={`h-3.5 rounded-md ${width}`} />
                <Skeleton className="h-3 w-[45%] rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sticky bottom-0 mt-auto border-t border-line bg-cream px-5 pt-3.5 pb-5">
        <Skeleton className="h-13.5 rounded-full" />
      </div>
    </div>
  );
}
