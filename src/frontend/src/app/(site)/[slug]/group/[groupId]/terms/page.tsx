import { GroupTermsHeader } from "../../../../../../features/group-terms/blocks/GroupTermsHeader";
import { GroupTermsHero } from "../../../../../../features/group-terms/blocks/GroupTermsHero";
import { GroupTermsList } from "../../../../../../features/group-terms/blocks/GroupTermsList";
import { GroupTermsPage } from "../../../../../../features/group-terms/GroupTermsPage";

type Props = { params: Promise<{ slug: string; groupId: string }> };

/** `/:slug/group/:groupId/terms`: the group tile and its upcoming terms. */
export default async function Page({ params }: Props) {
  const { slug, groupId } = await params;
  return (
    <GroupTermsPage key={`${slug}/${groupId}`} slug={slug} groupId={groupId}>
      <GroupTermsHeader />
      <GroupTermsHero />
      <GroupTermsList />
    </GroupTermsPage>
  );
}
