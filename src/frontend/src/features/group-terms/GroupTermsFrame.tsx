import type { ReactNode } from "react";
import { BlockSkeleton } from "../../components/shared/BlockSkeleton";
import { PageFrame } from "../../components/shared/PageFrame";

/** The page column of `/:slug/group/:groupId/terms`, above the footer. */
export function GroupTermsFrame({ children }: { children: ReactNode }) {
  return (
    <PageFrame>
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col pb-6">{children}</div>
    </PageFrame>
  );
}

/** The group page while it loads (also the route's `loading.tsx`). */
export function GroupTermsSkeleton() {
  return (
    <GroupTermsFrame>
      <BlockSkeleton shape="grid" />
      <BlockSkeleton shape="rows" />
    </GroupTermsFrame>
  );
}
