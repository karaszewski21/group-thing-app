"use client";

import { useQueryClient } from "@tanstack/react-query";
import { NotFoundFrame } from "../../components/shared/PageFrame";
import { ORGANIZATION_GROUP_TERMS_KEY } from "../../hooks/useOrganizationGroupTerms";
import { PUBLIC_ORGANIZATION_KEY } from "../../hooks/usePublicOrganization";
import { GroupTermsLoadError } from "./GroupTermsContext";
import { GroupTermsFrame } from "./GroupTermsFrame";
import { GROUP_TERMS_LOAD_ERROR } from "./groupTermsViewState";

const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The route's `not-found.tsx`: an unknown Organization, or a group that is
 * not one of its public groups. */
export function GroupTermsNotFound() {
  return <NotFoundFrame message="Ta grupa nie istnieje albo nie jest publiczna." />;
}

/** The route's `error.tsx`. "Spróbuj ponownie" clears the failed reads
 * before re-rendering the page, so they fetch again. */
export function GroupTermsError({ error, reset }: { error: Error; reset: () => void }) {
  const queryClient = useQueryClient();
  const message = error instanceof GroupTermsLoadError ? error.message : GROUP_TERMS_LOAD_ERROR;
  const retry = async () => {
    await Promise.all([
      queryClient.resetQueries({ queryKey: [ORGANIZATION_GROUP_TERMS_KEY] }),
      queryClient.resetQueries({ queryKey: [PUBLIC_ORGANIZATION_KEY] }),
    ]);
    reset();
  };
  return (
    <GroupTermsFrame>
      <p className="px-6 pt-4 text-[13px] text-ink-soft">
        {message}{" "}
        <button type="button" onClick={() => void retry()} className={RETRY_BUTTON}>
          Spróbuj ponownie
        </button>
      </p>
    </GroupTermsFrame>
  );
}
