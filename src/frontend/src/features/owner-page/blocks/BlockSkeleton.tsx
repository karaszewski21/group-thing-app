const BAR = "rounded bg-line/60 animate-pulse motion-reduce:animate-none";

/** Placeholder for a directory block while the directory loads: `rows` mimics
 * date-tile lists, `grid` mimics tiles and cards. */
export function BlockSkeleton({ shape }: { shape: "rows" | "grid" }) {
  return (
    <div aria-busy="true" className="px-6 pt-6">
      <span className="sr-only">Ładowanie…</span>
      <div aria-hidden="true" className={`mb-3 h-4 w-1/3 ${BAR}`} />
      {shape === "grid" ? (
        <div className="grid grid-cols-2 gap-2.5">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} aria-hidden="true" className={`aspect-square rounded-2xl ${BAR}`} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center gap-3">
              <div aria-hidden="true" className={`h-[46px] w-[46px] shrink-0 rounded-[13px] ${BAR}`} />
              <div className="flex flex-1 flex-col gap-2">
                <div aria-hidden="true" className={`h-3.5 w-3/4 ${BAR}`} />
                <div aria-hidden="true" className={`h-3 w-1/2 ${BAR}`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
