import { Skeleton } from "../../components/shared/Skeleton";
import { ADD_GRID, ADD_PAGE, GROUP_TILE_BOX, GROUP_TILES, PRODUCT_TILE_BOX, WANTED_ROW_BOX } from "./addLayout";

function GroupTileSkeleton({ tone }: { tone: string }) {
  return (
    <div className={`flex flex-col gap-2.5 p-3.5 @2xl:flex-row @2xl:gap-3.5 @2xl:p-5 ${GROUP_TILE_BOX} ${tone}`}>
      <Skeleton tone="paper" className="h-9 w-9 flex-none rounded-xl @2xl:h-12 @2xl:w-12 @2xl:rounded-2xl" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton tone="paper" className="h-4.5 w-4/5 rounded-md @2xl:h-5.5" />
        <Skeleton tone="paper" className="h-3 w-full rounded-md" />
        <Skeleton tone="paper" className="mt-2 h-6 w-20 rounded-full @2xl:mt-auto @2xl:w-32" />
      </div>
    </div>
  );
}

/** "Co dodajesz?" while the page loads, in the tiles' own grid and sizes. */
export function AddSkeleton() {
  return (
    <div aria-busy="true" className={ADD_PAGE}>
      <span className="sr-only">Wczytywanie…</span>
      <div className="mb-4 flex items-center justify-between gap-3 @2xl:mb-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-52 rounded-lg @2xl:h-10 @2xl:w-64" />
          <Skeleton className="hidden h-4 w-72 rounded-md @2xl:block" />
        </div>
        <Skeleton className="h-11 w-11 flex-none rounded-full @2xl:h-12 @2xl:w-12" />
      </div>

      <div className={ADD_GRID}>
        <div className={`flex flex-col justify-between gap-3.5 bg-primary-soft p-5 @2xl:p-7 ${PRODUCT_TILE_BOX}`}>
          <Skeleton tone="paper" className="h-14 w-14 rounded-[18px] @2xl:h-17 @2xl:w-17 @2xl:rounded-[22px]" />
          <div className="flex flex-col gap-2">
            <Skeleton tone="paper" className="h-7 w-48 rounded-lg @2xl:h-10 @2xl:w-64" />
            <Skeleton tone="paper" className="h-4 w-4/5 max-w-105 rounded-md" />
          </div>
          <div className="flex items-center justify-between gap-2.5">
            <Skeleton tone="paper" className="h-6 w-36 rounded-full" />
            <Skeleton tone="paper" className="h-11 w-44 rounded-full @2xl:h-13 @2xl:w-52" />
          </div>
        </div>
        <div className={GROUP_TILES}>
          <GroupTileSkeleton tone="bg-accent-soft" />
          <GroupTileSkeleton tone="bg-primary-soft" />
        </div>
      </div>

      <div className={`flex items-center gap-3 border border-line bg-paper py-2.5 pr-3 pl-2.5 @2xl:gap-3.5 @2xl:pr-4.5 @2xl:pl-3 ${WANTED_ROW_BOX}`}>
        <Skeleton className="h-11 w-11 flex-none rounded-[14px] @2xl:h-12 @2xl:w-12 @2xl:rounded-2xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-32 rounded-md" />
          <Skeleton className="h-3 w-52 max-w-full rounded-md" />
        </div>
        <Skeleton className="h-9 w-9 flex-none rounded-full @2xl:h-10 @2xl:w-10" />
      </div>
    </div>
  );
}
