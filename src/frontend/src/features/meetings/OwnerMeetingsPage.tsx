"use client";

import type { ReactNode } from "react";
import type { OwnerRef } from "../../hooks/useOwnerItems";
import { useOwnerMeetings } from "../../hooks/useOwnerMeetings";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { notFound } from "../../routing/navigation";
import { isPartyId } from "../../routing/paths";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { OwnerMeetingsLoadError, OwnerMeetingsPageContext } from "./OwnerMeetingsContext";
import { OwnerMeetingsFrame, OwnerMeetingsSkeleton } from "./OwnerMeetingsSkeleton";
import { resolveOwnerMeetingsView } from "./ownerMeetingsViewState";

type OrganizationRead = ReturnType<typeof usePublicOrganization>;

/** `/:slug/meetings` (an Organization, in its theme) or `/:partyId/meetings`
 * (any person with a public footprint): reads the owner's upcoming public
 * terms and events and gives the blocks passed as `children` (composed in
 * the route's `page.tsx`) their data through `OwnerMeetingsPageContext`. */
export function OwnerMeetingsPage({ slug, children }: { slug: string; children: ReactNode }) {
  return isPartyId(slug) ? (
    <OwnerMeetingsContent ownerRef={{ kind: "party", partyId: slug }} organization={null}>
      {children}
    </OwnerMeetingsContent>
  ) : (
    <OrganizationOwnerMeetings slug={slug}>{children}</OrganizationOwnerMeetings>
  );
}

function OrganizationOwnerMeetings({ slug, children }: { slug: string; children: ReactNode }) {
  const organization = usePublicOrganization(slug);
  return (
    <OwnerMeetingsContent ownerRef={{ kind: "organization", slug }} organization={organization}>
      {children}
    </OwnerMeetingsContent>
  );
}

function OwnerMeetingsContent({
  ownerRef,
  organization,
  children,
}: {
  ownerRef: OwnerRef;
  organization: OrganizationRead | null;
  children: ReactNode;
}) {
  const meetings = useOwnerMeetings(ownerRef);
  const view = resolveOwnerMeetingsView({ organization, meetings });
  switch (view.kind) {
    case "content": {
      const frame = <OwnerMeetingsFrame>{children}</OwnerMeetingsFrame>;
      return (
        <OwnerMeetingsPageContext.Provider value={{ owner: view.owner, meetings: view.meetings }}>
          {view.organization ? <OrganizerThemeScope theme={view.organization}>{frame}</OrganizerThemeScope> : frame}
        </OwnerMeetingsPageContext.Provider>
      );
    }
    case "notFound":
      return notFound();
    case "error":
      throw new OwnerMeetingsLoadError(view.message);
    case "loading":
      return <OwnerMeetingsSkeleton />;
  }
}
