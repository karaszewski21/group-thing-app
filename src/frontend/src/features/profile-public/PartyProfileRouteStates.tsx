"use client";

import { useQueryClient } from "@tanstack/react-query";
import { NotFoundFrame } from "../../components/shared/PageFrame";
import { OWNER_ITEMS_KEY } from "../../hooks/useOwnerItems";
import { PartyProfileLoadError } from "./PartyProfileContext";
import { PartyProfileFrame } from "./PartyProfileSkeleton";
import { PARTY_PROFILE_LOAD_ERROR } from "./partyProfileViewState";

const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The route's `not-found.tsx` for a party id: a person with nothing public. */
export function PartyProfileNotFound() {
  return <NotFoundFrame message="Ten profil nie istnieje albo nie jest publiczny." />;
}

/** The route's `error.tsx` for a party id. "Spróbuj ponownie" clears the
 * failed read before re-rendering the page, so it fetches again. */
export function PartyProfileError({ error, reset }: { error: Error; reset: () => void }) {
  const queryClient = useQueryClient();
  const message = error instanceof PartyProfileLoadError ? error.message : PARTY_PROFILE_LOAD_ERROR;
  const retry = async () => {
    await queryClient.resetQueries({ queryKey: [OWNER_ITEMS_KEY] });
    reset();
  };
  return (
    <PartyProfileFrame>
      <p className="text-[13px] text-ink-soft">
        {message}{" "}
        <button type="button" onClick={() => void retry()} className={RETRY_BUTTON}>
          Spróbuj ponownie
        </button>
      </p>
    </PartyProfileFrame>
  );
}
