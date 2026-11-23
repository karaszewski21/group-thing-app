import type { Metadata } from "next";
import { getPublicOrganizationOnServer } from "../../../api/server";
import { PublicOrganizationPage } from "../../../features/organization-public/PublicOrganizationPage";
import { PartyProfilePage } from "../../../features/profile-public/PartyProfilePage";
import { organizationMetadata } from "../../../lib/publicMetadata";
import { isPartyId } from "../../../routing/paths";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return organizationMetadata(await getPublicOrganizationOnServer((await params).slug));
}

/** `/:slug`: a party id opens the person's profile, anything else the
 * Organization's page; each renders the blocks of its own layout. Keyed on
 * the segment, so moving between two pages starts afresh. */
export default async function Page({ params }: Props) {
  const { slug } = await params;
  if (!isPartyId(slug)) return <PublicOrganizationPage key={slug} slug={slug} />;
  return <PartyProfilePage key={slug} partyId={slug} />;
}
