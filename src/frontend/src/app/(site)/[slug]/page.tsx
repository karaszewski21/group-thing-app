import type { Metadata } from "next";
import { getPublicOrganizationOnServer } from "../../../api/server";
import { PublicOrganizationPage } from "../../../features/organization-public/PublicOrganizationPage";
import { ProfileIntro } from "../../../features/profile-public/blocks/ProfileIntro";
import { ProfileItems } from "../../../features/profile-public/blocks/ProfileItems";
import { ProfileNearest } from "../../../features/profile-public/blocks/ProfileNearest";
import { ProfileOrganizerInvite } from "../../../features/profile-public/blocks/ProfileOrganizerInvite";
import { PartyProfilePage } from "../../../features/profile-public/PartyProfilePage";
import { organizationMetadata } from "../../../lib/publicMetadata";
import { isPartyId } from "../../../routing/paths";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return organizationMetadata(await getPublicOrganizationOnServer((await params).slug));
}

/** `/:slug`: a party id opens the person's profile, anything else the
 * Organization's page. Keyed on the segment, so moving between two pages
 * starts afresh. */
export default async function Page({ params }: Props) {
  const { slug } = await params;
  if (!isPartyId(slug)) return <PublicOrganizationPage key={slug} slug={slug} />;
  return (
    <PartyProfilePage key={slug} partyId={slug}>
      <ProfileIntro />
      <ProfileNearest />
      <ProfileItems />
      <ProfileOrganizerInvite />
    </PartyProfilePage>
  );
}
