"use client";

import { useQueryClient } from "@tanstack/react-query";
import { NotFoundFrame, PageFrame } from "../../components/shared/PageFrame";
import { ORGANIZATION_LAYOUT_KEY } from "../../hooks/useOrganizationLayout";
import { PUBLIC_ORGANIZATION_KEY } from "../../hooks/usePublicOrganization";
import { ORGANIZATION_PAGE_LOAD_ERROR, OrganizationPageLoadError } from "./organizationPageViewState";

const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The route's `not-found.tsx` for an Organization slug. */
export function OrganizationNotFound() {
  return <NotFoundFrame message="Ta organizacja nie istnieje." />;
}

/** The route's `error.tsx` for an Organization slug. "Spróbuj ponownie"
 * clears the failed reads before re-rendering the page, so they fetch again. */
export function OrganizationPageError({ error, reset }: { error: Error; reset: () => void }) {
  const queryClient = useQueryClient();
  const message = error instanceof OrganizationPageLoadError ? error.message : ORGANIZATION_PAGE_LOAD_ERROR;
  const retry = async () => {
    await Promise.all([
      queryClient.resetQueries({ queryKey: [PUBLIC_ORGANIZATION_KEY] }),
      queryClient.resetQueries({ queryKey: [ORGANIZATION_LAYOUT_KEY] }),
    ]);
    reset();
  };
  return (
    <PageFrame className="px-6 pt-6">
      <p className="text-[13px] text-ink-soft">
        {message}{" "}
        <button type="button" onClick={() => void retry()} className={RETRY_BUTTON}>
          Spróbuj ponownie
        </button>
      </p>
    </PageFrame>
  );
}
