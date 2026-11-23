import { OwnerMeetingsHeader } from "../../../../features/meetings/blocks/OwnerMeetingsHeader";
import { OwnerMeetingsList } from "../../../../features/meetings/blocks/OwnerMeetingsList";
import { OwnerMeetingsPage } from "../../../../features/meetings/OwnerMeetingsPage";

type Props = { params: Promise<{ slug: string }> };

export default async function Page({ params }: Props) {
  const { slug } = await params;
  return (
    <OwnerMeetingsPage slug={slug}>
      <OwnerMeetingsHeader />
      <OwnerMeetingsList />
    </OwnerMeetingsPage>
  );
}
