"use client";

import { useQueryClient } from "@tanstack/react-query";
import { OWNER_MEETINGS_KEY } from "../../hooks/useOwnerMeetings";
import { PUBLIC_ORGANIZATION_KEY } from "../../hooks/usePublicOrganization";
import { NotFoundFrame } from "../owner-page/PageFrame";
import { OwnerMeetingsLoadError } from "./OwnerMeetingsContext";
import { OwnerMeetingsFrame } from "./OwnerMeetingsSkeleton";
import { OWNER_MEETINGS_LOAD_ERROR } from "./ownerMeetingsViewState";

const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The route's `not-found.tsx`: an unknown Organization or a person with
 * nothing public. */
export function OwnerMeetingsNotFound() {
  return <NotFoundFrame message="Ten profil nie istnieje albo nie jest publiczny." />;
}

/** The route's `error.tsx`. "Spróbuj ponownie" clears the failed reads
 * before re-rendering the page, so they fetch again. */
export function OwnerMeetingsError({ error, reset }: { error: Error; reset: () => void }) {
  const queryClient = useQueryClient();
  const message = error instanceof OwnerMeetingsLoadError ? error.message : OWNER_MEETINGS_LOAD_ERROR;
  const retry = async () => {
    await Promise.all([
      queryClient.resetQueries({ queryKey: [OWNER_MEETINGS_KEY] }),
      queryClient.resetQueries({ queryKey: [PUBLIC_ORGANIZATION_KEY] }),
    ]);
    reset();
  };
  return (
    <OwnerMeetingsFrame>
      <p className="px-6 pt-4 text-[13px] text-ink-soft">
        {message}{" "}
        <button type="button" onClick={() => void retry()} className={RETRY_BUTTON}>
          Spróbuj ponownie
        </button>
      </p>
    </OwnerMeetingsFrame>
  );
}
