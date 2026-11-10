"use client";

import type { ReactNode } from "react";
import { BlockSkeleton } from "../../components/shared/BlockSkeleton";
import { PageFrame } from "../../components/shared/PageFrame";
import { Skeleton } from "../../components/shared/Skeleton";
import { useAppNavigate, useHasInAppHistory } from "../../routing/navigation";

const BACK_BUTTON =
  "inline-flex min-h-[44px] items-center gap-1.5 self-start text-[14px] font-bold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** "Wróć": the previous in-app page, else Start. `className` places it, e.g.
 * as a pill over the banner. */
export function BackButton({ className = BACK_BUTTON }: { className?: string }) {
  const navigate = useAppNavigate();
  const hasInAppHistory = useHasInAppHistory();
  return (
    <button type="button" onClick={() => (hasInAppHistory ? navigate(-1) : navigate("/"))} className={className}>
      <span aria-hidden="true">‹</span>
      Wróć
    </button>
  );
}

/** The profile's narrow column; the banner layout spans it edge to edge. */
export function PartyProfileColumn({ children }: { children: ReactNode }) {
  return (
    <PageFrame>
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col pb-8">{children}</div>
    </PageFrame>
  );
}

/** The column with the back button and side padding, for the skeleton and
 * the error state. */
export function PartyProfileFrame({ children }: { children: ReactNode }) {
  return (
    <PartyProfileColumn>
      <div className="flex flex-col gap-5 px-6 pt-4">
        <BackButton />
        {children}
      </div>
    </PartyProfileColumn>
  );
}

/** The route's `loading.tsx` and the page before the profile loads: the
 * banner, the avatar and the item grid. */
export function PartyProfileSkeleton() {
  return (
    <PartyProfileColumn>
      <div aria-busy="true" className="flex flex-col">
        <span className="sr-only">Wczytywanie…</span>
        <Skeleton className="h-36 w-full" />
        <Skeleton className="mx-auto -mt-10 size-20 rounded-full border-[3px] border-paper" />
        <div className="flex flex-col gap-5 px-6 pt-4">
          <Skeleton className="mx-auto h-7 w-48 rounded-xl" />
          <BlockSkeleton shape="grid" />
        </div>
      </div>
    </PartyProfileColumn>
  );
}
