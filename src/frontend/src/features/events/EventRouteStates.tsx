"use client";

import { useQueryClient } from "@tanstack/react-query";
import { EVENT_KEY } from "../../hooks/useEvent";
import { NotFoundFrame, PageFrame } from "../../components/shared/PageFrame";
import { EventLoadError } from "./EventPageContext";

export const RETRY_BUTTON =
  "mt-3 rounded-xl border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink hover:bg-cream";

const GENERIC_ERROR = "Nie udało się wyświetlić tego wydarzenia.";

/** The route's `not-found.tsx`: an unknown or deleted event. */
export function EventNotFound() {
  return <NotFoundFrame message="Nie znaleziono wydarzenia." />;
}

/** The route's `error.tsx`: a failed first read shows its message, any other
 * error the generic one. "Spróbuj ponownie" clears the failed read before
 * re-rendering the page, so it fetches again. */
export function EventPageError({ error, reset }: { error: Error; reset: () => void }) {
  const queryClient = useQueryClient();
  const retry = async () => {
    await queryClient.resetQueries({ queryKey: [EVENT_KEY] });
    reset();
  };
  return (
    <PageFrame className="px-5 pt-6">
      <p role="alert" className="text-[12.5px] font-semibold text-danger">
        {error instanceof EventLoadError ? `Nie udało się wczytać wydarzenia — ${error.message}` : GENERIC_ERROR}
      </p>
      <div>
        <button type="button" onClick={() => void retry()} className={RETRY_BUTTON}>
          Spróbuj ponownie
        </button>
      </div>
    </PageFrame>
  );
}
