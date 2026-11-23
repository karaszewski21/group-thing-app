import type { Metadata } from "next";
import { getPublicCircleOnServer } from "../../../../../../../api/server";
import { TermAttendees } from "../../../../../../../features/terms/blocks/TermAttendees";
import { TermChats } from "../../../../../../../features/terms/blocks/TermChats";
import { TermDescription } from "../../../../../../../features/terms/blocks/TermDescription";
import { TermHeader } from "../../../../../../../features/terms/blocks/TermHeader";
import { TermInfo } from "../../../../../../../features/terms/blocks/TermInfo";
import { TermLocation } from "../../../../../../../features/terms/blocks/TermLocation";
import { TermNeededItems } from "../../../../../../../features/terms/blocks/TermNeededItems";
import { TermSignUp } from "../../../../../../../features/terms/blocks/TermSignUp";
import { TermVisualization } from "../../../../../../../features/terms/blocks/TermVisualization";
import { TermPage } from "../../../../../../../features/terms/TermPage";
import { termMetadata } from "../../../../../../../lib/publicMetadata";
import { ServerThemeProvider } from "../../../../../../../theme/ServerThemeProvider";

type Props = { params: Promise<{ groupId: string; termId: string }> };

async function loadCircle(params: Props["params"]) {
  const { groupId, termId } = await params;
  return getPublicCircleOnServer(groupId, termId);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return termMetadata(await loadCircle(params));
}

export default async function Page({ params }: Props) {
  const { groupId, termId } = await params;
  const organization = (await loadCircle(params))?.organization ?? null;
  const page = (
    <TermPage groupId={groupId} termId={termId}>
      <TermHeader />
      <div className="flex-1">
        <TermVisualization />
        <TermInfo />
        <TermDescription />
        <TermLocation />
        <TermChats />
        <TermNeededItems />
        <TermAttendees />
      </div>
      <TermSignUp />
    </TermPage>
  );
  if (organization === null) return page;
  return <ServerThemeProvider initialTheme={organization}>{page}</ServerThemeProvider>;
}
