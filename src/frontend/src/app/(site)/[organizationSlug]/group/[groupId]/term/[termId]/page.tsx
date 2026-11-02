import type { Metadata } from "next";
import { getPublicCircleOnServer } from "../../../../../../../api/server";
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
  const organization = (await loadCircle(params))?.organization ?? null;
  if (organization === null) return <TermPage />;
  return (
    <ServerThemeProvider initialTheme={organization}>
      <TermPage />
    </ServerThemeProvider>
  );
}
