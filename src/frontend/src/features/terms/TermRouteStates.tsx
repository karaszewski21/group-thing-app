"use client";

import { useQueryClient } from "@tanstack/react-query";
import { GROUP_ACCESS_KEY } from "../../hooks/useTermAccess";
import { NotFoundFrame, PageFrame } from "../../components/shared/PageFrame";
import { TERM_LOAD_ERROR } from "./termViewState";

const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The route's `not-found.tsx`: an unknown group, or a term not in it. */
export function TermNotFound() {
  return <NotFoundFrame message="Te zajęcia nie istnieją albo zostały usunięte." />;
}

/** The route's `error.tsx`. "Spróbuj ponownie" clears the failed read before
 * re-rendering the page, so it fetches again. */
export function TermPageError({ reset }: { reset: () => void }) {
  const queryClient = useQueryClient();
  const retry = async () => {
    await queryClient.resetQueries({ queryKey: [GROUP_ACCESS_KEY] });
    reset();
  };
  return (
    <PageFrame>
      <p className="px-6 pt-4 text-[13px] text-ink-soft">
        {TERM_LOAD_ERROR}{" "}
        <button type="button" onClick={() => void retry()} className={RETRY_BUTTON}>
          Spróbuj ponownie
        </button>
      </p>
    </PageFrame>
  );
}
