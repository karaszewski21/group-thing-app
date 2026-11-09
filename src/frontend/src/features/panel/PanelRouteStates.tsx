"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "../../components/shared/Skeleton";
import { Link } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";

const RETRY_BUTTON =
  "mt-3 rounded-xl border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** A Konto sub-page while it loads (the routes' `loading.tsx`), drawn inside
 * the panel frame, which stays mounted. */
export function PanelSectionSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2.5">
      <span className="sr-only">Wczytywanie…</span>
      {["w-[72%]", "w-[58%]", "w-[66%]"].map((width) => (
        <div key={width} className="flex items-center gap-3.5 rounded-[22px] border border-line bg-paper p-3.5">
          <Skeleton className="h-11 w-11 shrink-0 rounded-[14px]" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className={`h-4 rounded-lg ${width}`} />
            <Skeleton className="h-3 w-1/2 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The routes' `not-found.tsx`: a sub-page with nothing to show, with the way back to Konto. */
export function PanelSectionNotFound() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[22px] border border-dashed border-line bg-paper p-5 text-center">
      <p className="text-[15px] font-semibold text-ink">Nie znaleziono tej strony.</p>
      <Link to={viewPath("account")} className="text-[13px] font-bold text-primary-fg underline">
        Wróć do konta
      </Link>
    </div>
  );
}

/** The routes' `error.tsx`. "Spróbuj ponownie" clears the failed reads
 * before re-rendering the sub-page, so they fetch again. */
export function PanelSectionError({ reset }: { reset: () => void }) {
  const queryClient = useQueryClient();
  const retry = async () => {
    await queryClient.resetQueries({ predicate: (query) => query.state.status === "error" });
    reset();
  };
  return (
    <div>
      <p role="alert" className="text-[12.5px] font-semibold text-danger">
        Nie udało się wyświetlić tej strony.
      </p>
      <button type="button" onClick={() => void retry()} className={RETRY_BUTTON}>
        Spróbuj ponownie
      </button>
    </div>
  );
}
