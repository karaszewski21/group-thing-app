"use client";

import type { MyOrganizationResponse, UpdateOrganizationRequest } from "../../api/organizations";
import { familyInitials } from "../../components/shared/Avatar";
import { useAuth } from "../../auth/AuthContext";
import { authPath } from "../../auth/authPaths";
import { useMediaActions } from "../../hooks/useMediaActions";
import { useMyOrganization } from "../../hooks/useMyOrganization";
import { useOrganizationLayout } from "../../hooks/useOrganizationLayout";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { useUpdateOrganization } from "../../hooks/useUpdateOrganization";
import { Navigate, notFound, useAppPathname } from "../../routing/navigation";
import { AppearanceEditor } from "../editor/AppearanceEditor";
import { AppearanceFrame, AppearanceSkeleton } from "../editor/AppearanceFrame";
import { AppearanceLoadError, resolveAppearanceView } from "../editor/appearanceViewState";
import { toDraft, type DraftChanges } from "../editor/draft";
import type { LayoutOption } from "../editor/LayoutTab";
import { PhotosTab } from "../editor/PhotosTab";
import { isRecommended, LAYOUT_REGISTRY, resolveLayout } from "./layouts/registry";
import { directoryStatusOf } from "./organizationPageViewState";

/** The editor's changes as an Organization `PATCH` ("O nas" is its description). */
function toRequest({ about, ...rest }: DraftChanges): UpdateOrganizationRequest {
  return about === undefined ? rest : { ...rest, description: about };
}

/** `/:slug/appearance` for an Organization: its owner edits the photos,
 * description, name, layout and colors. Anyone else gets not found. */
export function OrganizationAppearancePage({ slug }: { slug: string }) {
  const { token } = useAuth();
  const pathname = useAppPathname();
  const myOrganization = useMyOrganization({ pollPendingMedia: true });
  const view = resolveAppearanceView({
    loggedIn: token !== null,
    loading: myOrganization.loading,
    error: myOrganization.error,
    owner: myOrganization.data?.slug === slug ? myOrganization.data : null,
  });
  switch (view.kind) {
    case "login":
      return <Navigate to={authPath("login", pathname)} replace />;
    case "loading":
      return <AppearanceSkeleton />;
    case "notFound":
      return notFound();
    case "error":
      throw new AppearanceLoadError(view.message);
    case "content":
      return (
        <AppearanceFrame>
          <OrganizationEditor organization={view.owner} />
        </AppearanceFrame>
      );
  }
}

function OrganizationEditor({ organization }: { organization: MyOrganizationResponse }) {
  const publicOrganization = usePublicOrganization(organization.slug);
  // The badges need only the stats, which LINKS carries alone.
  const statsRead = useOrganizationLayout(organization.slug, "LINKS");
  const statsStatus = directoryStatusOf(statsRead);
  const stats = statsStatus === "ready" ? (statsRead.data?.stats ?? null) : null;
  const { update } = useUpdateOrganization();
  const actions = useMediaActions({ kind: "organization", organizationId: organization.id });

  const layouts: LayoutOption[] | null = publicOrganization.data
    ? Object.values(LAYOUT_REGISTRY).map((layout) => ({
        ...layout,
        recommended: isRecommended(layout, stats, statsStatus),
      }))
    : null;

  return (
    <AppearanceEditor
      baseline={toDraft({
        name: organization.name,
        about: organization.description,
        pageLayout: resolveLayout(organization.page_layout).key,
        palette_preset: organization.palette_preset,
        primary_color: organization.primary_color,
        accent_color: organization.accent_color,
      })}
      save={(changes) => update(organization.id, toRequest(changes))}
      photos={<PhotosTab media={organization.media} actions={actions} initials={familyInitials(organization.name)} />}
      about={{ label: "O nas", placeholder: "Kim jesteście, dla kogo są zajęcia, czego można się spodziewać?" }}
      name={{ label: "Nazwa organizacji", hint: "Widoczna na Twojej stronie. Adres strony się nie zmienia." }}
      layouts={layouts}
      viewHref={`/${organization.slug}`}
    />
  );
}
