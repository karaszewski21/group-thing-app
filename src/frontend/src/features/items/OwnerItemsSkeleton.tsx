import type { ReactNode } from "react";
import { BlockSkeleton } from "../../components/shared/BlockSkeleton";
import { PageFrame } from "../../components/shared/PageFrame";

/** The page column of `/:slug/items`, above the footer. */
export function OwnerItemsFrame({ children }: { children: ReactNode }) {
  return (
    <PageFrame>
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col">
        {children}
      </div>
    </PageFrame>
  );
}

/** The owner items page while it loads (also the route's `loading.tsx`). */
export function OwnerItemsSkeleton() {
  return (
    <OwnerItemsFrame>
      <BlockSkeleton shape="grid" />
    </OwnerItemsFrame>
  );
}
