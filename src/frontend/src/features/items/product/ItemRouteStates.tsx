"use client";

import { useResetItemDetails } from "../../../hooks/useItemDetail";
import { ItemLoadStates } from "./ItemLoadStates";
import { ItemLoadError } from "./ItemPageContext";

const FRAME = "flex-1 overflow-y-auto px-4.5 pt-4.5 pb-6";
const GENERIC_ERROR = "Nie udało się wyświetlić tej rzeczy.";

/** The route's `not-found.tsx`: an unknown item, or one the viewer may not see. */
export function ItemNotFound() {
  return (
    <div className={FRAME}>
      <ItemLoadStates notFound error={null} loading={false} />
    </div>
  );
}

/** The route's `error.tsx`: a failed details read shows its message, any
 * other error the generic one. "Spróbuj ponownie" clears the failed read
 * before re-rendering the page, so it fetches again. */
export function ItemPageError({ error, reset }: { error: Error; reset: () => void }) {
  const resetDetails = useResetItemDetails();
  const message = error instanceof ItemLoadError ? error.message : GENERIC_ERROR;
  return (
    <div className={FRAME}>
      <ItemLoadStates
        notFound={false}
        error={message}
        loading={false}
        onRetry={() => void resetDetails().then(reset)}
      />
    </div>
  );
}
