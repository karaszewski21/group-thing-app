import { useAppParams, Link } from "../../routing/navigation";
import { useMyOrganization } from "../../hooks/useMyOrganization";
import { useOrganizerPage } from "../../hooks/useOrganizerPage";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { viewPath } from "../../routing/paths";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { SettingsIcon } from "../../components/shared/appIcons";
import { LayoutRenderer } from "./LayoutRenderer";
import { resolveLayout } from "./layouts/registry";
import type { DirectoryStatus, OrganizerPageData } from "./layouts/types";
import { NotFoundFrame, PageFrame } from "./PageFrame";
import { OrganizerPageSkeleton } from "./OrganizerPageSkeleton";

/**
 * Public organizer page at `domena.pl/<slug>` — this is the mounted-last
 * catch-all route in `router.tsx` (after every fixed route), which is exactly
 * why `slugs.RESERVED_SLUGS` on the backend must never hand out a slug
 * matching one of those fixed paths: this route would otherwise permanently
 * shadow it. The owner sees the same page plus ghosts and a settings link
 * ("Ustawienia") in the hero to the panel's "Wygląd strony"
 * (`/organization/appearance`).
 */
export function PublicOrganizationPage() {
  const { slug = "" } = useAppParams<{ slug: string }>();
  const { data: organization, loading } = usePublicOrganization(slug);
  // Fetched in parallel; the directory never holds back the first paint.
  const directory = useOrganizerPage(slug);
  const directoryStatus: DirectoryStatus = directory.loading
    ? "loading"
    : directory.notFound || directory.error !== null
      ? "unavailable"
      : "ready";
  const myOrganization = useMyOrganization();
  const isOwner = myOrganization.data?.slug === slug;

  if (loading) return <OrganizerPageSkeleton />;

  if (!organization) return <NotFoundFrame />;

  const pageData: OrganizerPageData = {
    organization,
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
    <OrganizerThemeScope theme={organization}>
      <PageFrame>
        <LayoutRenderer
          layout={resolveLayout(organization.page_layout)}
          data={pageData}
          mode={isOwner ? "owner-edit" : "visitor"}
          heroAction={settingsLink}
        />
      </PageFrame>
    </OrganizerThemeScope>
  );
}
