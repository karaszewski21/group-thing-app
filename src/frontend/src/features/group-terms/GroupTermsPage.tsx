"use client";

import type { ReactNode } from "react";
import { useOrganizationGroupTerms } from "../../hooks/useOrganizationGroupTerms";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { notFound } from "../../routing/navigation";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { GroupTermsLoadError, GroupTermsPageContext } from "./GroupTermsContext";
import { GroupTermsFrame, GroupTermsSkeleton } from "./GroupTermsFrame";
import { resolveGroupTermsView } from "./groupTermsViewState";

/** `/:slug/group/:groupId/terms`: one public group of the Organization, in
 * its theme, giving the blocks passed as `children` (composed in the route's
 * `page.tsx`) the group and its upcoming terms through `GroupTermsPageContext`. */
export function GroupTermsPage({ slug, groupId, children }: { slug: string; groupId: string; children: ReactNode }) {
  const organization = usePublicOrganization(slug);
  const group = useOrganizationGroupTerms(slug, groupId);
  const view = resolveGroupTermsView({ organization, group });
  switch (view.kind) {
    case "content":
      return (
        <GroupTermsPageContext.Provider value={view.page}>
          <OrganizerThemeScope theme={view.organization}>
            <GroupTermsFrame>{children}</GroupTermsFrame>
          </OrganizerThemeScope>
        </GroupTermsPageContext.Provider>
      );
    case "notFound":
      return notFound();
    case "error":
      throw new GroupTermsLoadError(view.message);
    case "loading":
      return <GroupTermsSkeleton />;
  }
}
