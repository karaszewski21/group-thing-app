"use client";

import { useQueryClient } from "@tanstack/react-query";
import { OWNER_ITEMS_KEY } from "../../hooks/useOwnerItems";
import { PUBLIC_ORGANIZATION_KEY } from "../../hooks/usePublicOrganization";
import { NotFoundFrame } from "../../components/shared/PageFrame";
import { OwnerItemsLoadError } from "./OwnerItemsContext";
import { OwnerItemsFrame } from "./OwnerItemsSkeleton";
import { OWNER_ITEMS_LOAD_ERROR } from "./ownerItemsViewState";

const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The route's `not-found.tsx`: an unknown Organization or owner. */
export function OwnerItemsNotFound() {
  return <NotFoundFrame message="Nie ma tu żadnych rzeczy." />;
}

/** The route's `error.tsx`. "Spróbuj ponownie" clears the failed reads
 * before re-rendering the page, so they fetch again. */
export function OwnerItemsError({ error, reset }: { error: Error; reset: () => void }) {
  const queryClient = useQueryClient();
  const message = error instanceof OwnerItemsLoadError ? error.message : OWNER_ITEMS_LOAD_ERROR;
  const retry = async () => {
    await Promise.all([
      queryClient.resetQueries({ queryKey: [OWNER_ITEMS_KEY] }),
      queryClient.resetQueries({ queryKey: [PUBLIC_ORGANIZATION_KEY] }),
    ]);
    reset();
  };
  return (
    <OwnerItemsFrame>
      <p className="px-6 pt-4 text-[13px] text-ink-soft">
        {message}{" "}
        <button type="button" onClick={() => void retry()} className={RETRY_BUTTON}>
          Spróbuj ponownie
        </button>
      </p>
    </OwnerItemsFrame>
  );
}
