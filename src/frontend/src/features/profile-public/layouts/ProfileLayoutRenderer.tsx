"use client";

import type { ComponentType } from "react";
import { ProfileGallery } from "../blocks/ProfileGallery";
import { ProfileHero } from "../blocks/ProfileHero";
import { ProfileIntro } from "../blocks/ProfileIntro";
import { ProfileItems } from "../blocks/ProfileItems";
import { ProfileNearest } from "../blocks/ProfileNearest";
import { ProfileOrganizerInvite } from "../blocks/ProfileOrganizerInvite";
import { ProfileStartHere } from "../blocks/ProfileStartHere";
import { resolveProfileLayout, type ProfileLayoutKey } from "./registry";

/** BANNER: the banner with the avatar, name and bio, the gallery, the
 * nearest pickup dates, the person's items (empty boxes when there are
 * none) and, for themself, the Organization card. */
function BannerLayout() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        <ProfileHero />
        <ProfileIntro />
      </div>
      <ProfileGallery />
      <ProfileStartHere />
      <ProfileNearest />
      <ProfileItems />
      <ProfileOrganizerInvite />
    </div>
  );
}

const LAYOUTS: Record<ProfileLayoutKey, ComponentType> = {
  BANNER: BannerLayout,
};

/** The profile's blocks in its stored layout (unknown keys fall back). */
export function ProfileLayoutRenderer({ layoutKey }: { layoutKey: string }) {
  const Layout = LAYOUTS[resolveProfileLayout(layoutKey).key];
  return <Layout />;
}
