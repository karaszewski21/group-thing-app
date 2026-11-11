"use client";

import type { UpdateMyProfileAppearanceRequest, UserProfileResponse } from "../../api/people";
import { familyInitials } from "../../components/shared/Avatar";
import { useAuth } from "../../auth/AuthContext";
import { authPath } from "../../auth/authPaths";
import { useMediaActions } from "../../hooks/useMediaActions";
import { useMyOrganization } from "../../hooks/useMyOrganization";
import { useMyProfile } from "../../hooks/useMyProfile";
import { useUpdateMyProfile } from "../../hooks/useUpdateMyProfile";
import { Link, Navigate, notFound, useAppPathname } from "../../routing/navigation";
import { appearancePath } from "../../routing/paths";
import { AppearanceEditor } from "../editor/AppearanceEditor";
import { AppearanceFrame, AppearanceSkeleton } from "../editor/AppearanceFrame";
import { AppearanceLoadError, resolveAppearanceView } from "../editor/appearanceViewState";
import { toDraft, type Draft, type DraftChanges } from "../editor/draft";
import type { LayoutOption } from "../editor/LayoutTab";
import { PhotosTab } from "../editor/PhotosTab";
import { LAYOUT_REGISTRY } from "../organization-public/layouts/registry";
import { PROFILE_LAYOUT_REGISTRY, resolveProfileLayout } from "./layouts/registry";

/** The profile's own layouts, then every Organization layout, locked: the
 * invite to found an Organization. */
const LAYOUTS: LayoutOption[] = [
  ...Object.values(PROFILE_LAYOUT_REGISTRY),
  ...Object.values(LAYOUT_REGISTRY).map(({ key, label, description, thumbnail }) => ({
    key,
    label,
    description,
    thumbnail,
    locked: true,
  })),
];

const NOTE_LINK = "mt-2 inline-flex min-h-11 items-center font-extrabold text-primary-fg underline";

/** Why the Organization layouts are locked here: the invite to found one,
 * or for an owner the way to their Organization's own editor. */
function LockedNote({ organizationSlug }: { organizationSlug: string | null }) {
  if (organizationSlug) {
    return (
      <>
        <p className="font-bold">Te układy są na stronie Twojej organizacji.</p>
        <p className="mt-1 text-ink-soft">Profil ma własne układy; organizacja wybiera spośród wszystkich.</p>
        <Link to={appearancePath(organizationSlug, "layout")} className={NOTE_LINK}>
          Wygląd strony organizacji →
        </Link>
      </>
    );
  }
  return (
    <>
      <p className="font-bold">Więcej układów masz na stronie organizacji.</p>
      <p className="mt-1 text-ink-soft">
        Załóż organizację, a odblokujesz wszystkie układy. Twoje zdjęcia przeniesiemy na jej stronę.
      </p>
      <Link to="/organization" className={NOTE_LINK}>
        Załóż organizację →
      </Link>
    </>
  );
}

/** The look and the bio ("O mnie"); the name goes through `PATCH /people/me`. */
function toAppearanceRequest(changes: DraftChanges): UpdateMyProfileAppearanceRequest {
  const request: UpdateMyProfileAppearanceRequest = {};
  if (changes.page_layout !== undefined) request.page_layout = changes.page_layout;
  if (changes.palette_preset !== undefined) request.palette_preset = changes.palette_preset;
  if (changes.primary_color !== undefined) request.primary_color = changes.primary_color;
  if (changes.accent_color !== undefined) request.accent_color = changes.accent_color;
  if (changes.about !== undefined) request.bio = changes.about;
  return request;
}

/** `/:partyId/appearance`: the person edits their profile's photos, "O
 * mnie", name, layout and colors. Anyone else gets not found. */
export function ProfileAppearancePage({ partyId }: { partyId: string }) {
  const { token } = useAuth();
  const pathname = useAppPathname();
  const profile = useMyProfile({ pollPendingMedia: true });
  const view = resolveAppearanceView({
    loggedIn: token !== null,
    loading: profile.loading,
    error: profile.error,
    owner: profile.data?.party_id === partyId ? profile.data : null,
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
          <ProfileEditor profile={view.owner} />
        </AppearanceFrame>
      );
  }
}

function ProfileEditor({ profile }: { profile: UserProfileResponse }) {
  const { updateAppearance, updateDetails } = useUpdateMyProfile();
  const myOrganization = useMyOrganization();
  const actions = useMediaActions({ kind: "me" });

  async function save(changes: DraftChanges, draft: Draft) {
    const appearance = toAppearanceRequest(changes);
    if (Object.keys(appearance).length > 0) await updateAppearance(appearance);
    // The name is saved with the bio, which `PATCH /people/me` replaces too.
    if (changes.name !== undefined) {
      await updateDetails({ display_name: changes.name, bio: draft.about.trim() || null });
    }
  }

  return (
    <AppearanceEditor
      baseline={toDraft({
        name: profile.display_name,
        about: profile.bio,
        pageLayout: resolveProfileLayout(profile.page_layout).key,
        palette_preset: profile.palette_preset,
        primary_color: profile.primary_color,
        accent_color: profile.accent_color,
      })}
      save={save}
      photos={<PhotosTab media={profile.media} actions={actions} initials={familyInitials(profile.display_name)} />}
      about={{ label: "O mnie", placeholder: "Kilka słów o sobie: co oddajesz, czego szukasz?" }}
      name={{ label: "Imię i nazwisko", hint: "Widoczne na Twoim profilu i przy Twoich rzeczach." }}
      layouts={LAYOUTS}
      lockedNote={<LockedNote organizationSlug={myOrganization.data?.slug ?? null} />}
      viewHref={`/${profile.party_id}`}
    />
  );
}
