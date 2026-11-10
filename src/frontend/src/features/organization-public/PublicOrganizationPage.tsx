"use client";

import { Link, notFound } from "../../routing/navigation";
import { useMyOrganization } from "../../hooks/useMyOrganization";
import { useOrganizerPage } from "../../hooks/useOrganizerPage";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { viewPath } from "../../routing/paths";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { SettingsIcon } from "../../components/shared/appIcons";
import { PageFrame } from "../../components/shared/PageFrame";
import { LayoutRenderer } from "./LayoutRenderer";
import { resolveLayout } from "./layouts/registry";
import type { OrganizerPageData } from "./layouts/types";
import { directoryStatusOf, OrganizationPageLoadError, resolveOrganizationPageView } from "./organizationPageViewState";
import { OrganizerPageSkeleton } from "./OrganizerPageSkeleton";

/**
 * Public organizer page at `domena.pl/<slug>`, under the catch-all `[slug]`
 * route, which is why `slugs.RESERVED_SLUGS` on the backend must never hand
 * out a slug matching a fixed path: this route would otherwise shadow it.
 * Shows exactly one screen per `resolveOrganizationPageView` state; the
 * blocks come from the Organization's layout, not from the route. The owner
 * sees the same page plus ghosts and a settings link ("Ustawienia") in the
 * hero to the panel's "Wygląd strony" (`/organization/appearance`).
 */
export function PublicOrganizationPage({ slug }: { slug: string }) {
  const organization = usePublicOrganization(slug);
  // Fetched in parallel; the directory never holds back the first paint.
  const directory = useOrganizerPage(slug);
  const directoryStatus = directoryStatusOf(directory);
  const myOrganization = useMyOrganization();
  const isOwner = myOrganization.data?.slug === slug;
  const view = resolveOrganizationPageView(organization);

  switch (view.kind) {
    case "loading":
      return <OrganizerPageSkeleton />;
    case "notFound":
      return notFound();
    case "error":
      throw new OrganizationPageLoadError(view.message);
    case "content": {
      const pageData: OrganizerPageData = {
        organization: view.organization,
        directory: directoryStatus === "ready" ? directory.data : null,
        directoryStatus,
      };

      // Placed by the hero, so it floats over the cover photo or color band.
      const settingsLink = isOwner ? (
        <Link
          to={viewPath("organization/appearance")}
          aria-label="Ustawienia"
          title="Ustawienia"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-paper/90 text-ink shadow-md hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <SettingsIcon c="currentColor" />
        </Link>
      ) : undefined;

      return (
        <OrganizerThemeScope theme={view.organization}>
          <PageFrame>
            <LayoutRenderer
              layout={resolveLayout(view.organization.page_layout)}
              data={pageData}
              mode={isOwner ? "owner-edit" : "visitor"}
              heroAction={settingsLink}
            />
          </PageFrame>
        </OrganizerThemeScope>
      );
    }
  }
}
