import { OrganizationAppearancePage } from "../../../../features/organization-public/OrganizationAppearancePage";
import { ProfileAppearancePage } from "../../../../features/profile-public/ProfileAppearancePage";
import { isPartyId } from "../../../../routing/paths";

type Props = { params: Promise<{ slug: string }> };

export const metadata = { title: "Wygląd strony", robots: { index: false } };

/** `/:slug/appearance`: the owner's "Wygląd strony" of a person's profile
 * (party id) or an Organization's page. */
export default async function Page({ params }: Props) {
  const { slug } = await params;
  return isPartyId(slug) ? (
    <ProfileAppearancePage key={slug} partyId={slug} />
  ) : (
    <OrganizationAppearancePage key={slug} slug={slug} />
  );
}
