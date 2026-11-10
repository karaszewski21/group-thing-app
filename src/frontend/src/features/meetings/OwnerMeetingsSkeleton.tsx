import type { ReactNode } from "react";
import { BlockSkeleton } from "../../components/shared/BlockSkeleton";
import { PageFrame } from "../../components/shared/PageFrame";

/** The page column of `/:slug/meetings`, above the footer. */
export function OwnerMeetingsFrame({ children }: { children: ReactNode }) {
  return (
    <PageFrame>
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col">{children}</div>
    </PageFrame>
  );
}

/** The owner meetings page while it loads (also the route's `loading.tsx`). */
export function OwnerMeetingsSkeleton() {
  return (
    <OwnerMeetingsFrame>
      <BlockSkeleton shape="rows" />
    </OwnerMeetingsFrame>
  );
}
