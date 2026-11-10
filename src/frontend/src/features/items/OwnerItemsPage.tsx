"use client";

import { useState, type ReactNode } from "react";
import { useOwnerItems, type OwnerRef } from "../../hooks/useOwnerItems";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { notFound } from "../../routing/navigation";
import { isPartyId } from "../../routing/paths";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import {
  OwnerItemsLoadError,
  OwnerItemsPageContext,
  type OwnerItemsFilter,
  type OwnerItemsPageValue,
} from "./OwnerItemsContext";
import { OwnerItemsFrame, OwnerItemsSkeleton } from "./OwnerItemsSkeleton";
import { resolveOwnerItemsView } from "./ownerItemsViewState";

type OrganizationRead = ReturnType<typeof usePublicOrganization>;

/** `/:slug/items` (an Organization, in its theme) or `/:partyId/items` (any
 * person): reads the owner's listed items and gives the blocks passed as
 * `children` (composed in the route's `page.tsx`) their data through
 * `OwnerItemsPageContext`. */
export function OwnerItemsPage({ slug, children }: { slug: string; children: ReactNode }) {
  return isPartyId(slug) ? (
    <OwnerItemsContent ownerRef={{ kind: "party", partyId: slug }} organization={null}>
      {children}
    </OwnerItemsContent>
  ) : (
    <OrganizationOwnerItems slug={slug}>{children}</OrganizationOwnerItems>
  );
}

function OrganizationOwnerItems({ slug, children }: { slug: string; children: ReactNode }) {
  const organization = usePublicOrganization(slug);
  return (
    <OwnerItemsContent ownerRef={{ kind: "organization", slug }} organization={organization}>
      {children}
    </OwnerItemsContent>
  );
}

function OwnerItemsContent({
  ownerRef,
  organization,
  children,
}: {
  ownerRef: OwnerRef;
  organization: OrganizationRead | null;
  children: ReactNode;
}) {
  const [filter, setFilter] = useState<OwnerItemsFilter>("ALL");
  const items = useOwnerItems(ownerRef, filter === "ALL" ? undefined : filter);
  const view = resolveOwnerItemsView({ organization, items });
  switch (view.kind) {
    case "content": {
      const value: OwnerItemsPageValue = {
        ownerRef,
        owner: view.owner,
        counts: view.counts,
        items,
        filter,
        setFilter,
      };
      const frame = <OwnerItemsFrame>{children}</OwnerItemsFrame>;
      return (
        <OwnerItemsPageContext.Provider value={value}>
          {view.organization ? <OrganizerThemeScope theme={view.organization}>{frame}</OrganizerThemeScope> : frame}
        </OwnerItemsPageContext.Provider>
      );
    }
    case "notFound":
      return notFound();
    case "error":
      throw new OwnerItemsLoadError(view.message);
    case "loading":
      return <OwnerItemsSkeleton />;
  }
}
