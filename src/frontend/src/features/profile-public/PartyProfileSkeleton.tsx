"use client";

import type { ReactNode } from "react";
import { BlockSkeleton } from "../../components/shared/BlockSkeleton";
import { PageFrame } from "../../components/shared/PageFrame";
import { useAppNavigate, useHasInAppHistory } from "../../routing/navigation";

const BACK_BUTTON =
  "inline-flex min-h-[44px] items-center gap-1.5 self-start text-[14px] font-bold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function BackButton() {
  const navigate = useAppNavigate();
  const hasInAppHistory = useHasInAppHistory();
  return (
    <button
      type="button"
      onClick={() => (hasInAppHistory ? navigate(-1) : navigate("/"))}
      className={BACK_BUTTON}
    >
      <span aria-hidden="true">‹</span>
      Wróć
    </button>
  );
}

/** The profile's narrow column with the back button, shared by the loaded
 * page, its skeleton and its error state. */
export function PartyProfileFrame({ children }: { children: ReactNode }) {
  return (
    <PageFrame>
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col">
        <div className="flex flex-col gap-5 px-6 pt-4">
          <BackButton />
          {children}
        </div>
      </div>
    </PageFrame>
  );
}

/** The route's `loading.tsx` and the page before the profile loads. */
export function PartyProfileSkeleton() {
  return (
    <PartyProfileFrame>
      <BlockSkeleton shape="grid" />
    </PartyProfileFrame>
  );
}
