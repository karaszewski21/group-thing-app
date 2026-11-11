"use client";

import { Link, notFound } from "../../routing/navigation";
import { useMyOrganization } from "../../hooks/useMyOrganization";
import { useOrganizationLayout } from "../../hooks/useOrganizationLayout";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { appearancePath } from "../../routing/paths";
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
 * hero to the page's "Wygląd strony" (`/<slug>/appearance`).
 */
export function PublicOrganizationPage({ slug }: { slug: string }) {
  const organization = usePublicOrganization(slug);
  // The layout is known only with the Organization, so its data follows it;
  // it never holds back the first paint.
  const layout = resolveLayout(organization.data?.page_layout);
  const directory = useOrganizationLayout(slug, layout.key, { enabled: organization.data !== null });
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
          to={appearancePath(slug)}
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
              layout={layout}
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
