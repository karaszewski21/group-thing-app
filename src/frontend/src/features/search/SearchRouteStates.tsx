"use client";

import { useQueryClient } from "@tanstack/react-query";
import { SEARCH_KEY } from "../../hooks/useSearch";

export const SEARCH_LOAD_ERROR = "Nie udało się wczytać wyszukiwania.";

const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The route's `error.tsx`. "Spróbuj ponownie" clears the cached searches
 * before re-rendering the page, so it fetches again. */
export function SearchPageError({ reset }: { reset: () => void }) {
  const queryClient = useQueryClient();
  const retry = async () => {
    await queryClient.resetQueries({ queryKey: [SEARCH_KEY] });
    reset();
  };
  return (
    <p role="alert" className="text-[13px] text-ink-soft">
      {SEARCH_LOAD_ERROR}{" "}
      <button type="button" onClick={() => void retry()} className={RETRY_BUTTON}>
        Spróbuj ponownie
      </button>
    </p>
  );
}
