"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BlockSkeleton } from "../../components/shared/BlockSkeleton";
import { NotFoundFrame, PageFrame } from "../../components/shared/PageFrame";
import { MY_ORGANIZATION_KEY } from "../../hooks/useMyOrganization";
import { MY_PROFILE_KEY } from "../../hooks/useMyProfile";
import { APPEARANCE_LOAD_ERROR, AppearanceLoadError } from "./appearanceViewState";

const TITLE = "Wygląd strony";
const RETRY_BUTTON =
  "min-h-[44px] font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The editor's column under the page title. */
export function AppearanceFrame({ children }: { children: ReactNode }) {
  return (
    <PageFrame>
      <section aria-labelledby="appearance-title" className="mx-auto flex w-full max-w-[560px] flex-col px-4 pt-5 pb-8">
        <h1 id="appearance-title" className="mb-4 font-serif text-[26px] font-semibold text-ink">
          {TITLE}
        </h1>
        {children}
      </section>
    </PageFrame>
  );
}

/** The route's `loading.tsx` and the editor before its owner loads. */
export function AppearanceSkeleton() {
  return (
    <AppearanceFrame>
      <BlockSkeleton shape="rows" />
    </AppearanceFrame>
  );
}

/** The route's `not-found.tsx`: not the caller's own page. */
export function AppearanceNotFound() {
  return <NotFoundFrame message="Tej strony nie możesz edytować." />;
}

/** The route's `error.tsx`. "Spróbuj ponownie" clears the owner reads
 * before re-rendering the page, so they fetch again. */
export function AppearanceError({ error, reset }: { error: Error; reset: () => void }) {
  const queryClient = useQueryClient();
  const message = error instanceof AppearanceLoadError ? error.message : APPEARANCE_LOAD_ERROR;
  const retry = async () => {
    await Promise.all([
      queryClient.resetQueries({ queryKey: [MY_ORGANIZATION_KEY] }),
      queryClient.resetQueries({ queryKey: [MY_PROFILE_KEY] }),
    ]);
    reset();
  };
  return (
    <AppearanceFrame>
      <p className="text-[13px] text-ink-soft">
        {message}{" "}
        <button type="button" onClick={() => void retry()} className={RETRY_BUTTON}>
          Spróbuj ponownie
        </button>
      </p>
    </AppearanceFrame>
  );
}
