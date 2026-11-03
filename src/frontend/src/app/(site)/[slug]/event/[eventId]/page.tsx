import type { Metadata } from "next";
import { getEventOnServer } from "../../../../../api/server";
import { EventPage } from "../../../../../features/events/EventPage";
import { eventMetadata } from "../../../../../lib/publicMetadata";
import { ServerThemeProvider } from "../../../../../theme/ServerThemeProvider";

type Props = { params: Promise<{ eventId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return eventMetadata(await getEventOnServer((await params).eventId));
}

export default async function Page({ params }: Props) {
  const organization = (await getEventOnServer((await params).eventId))?.organization ?? null;
  if (organization === null) return <EventPage />;
  return (
    <ServerThemeProvider initialTheme={organization}>
      <EventPage />
    </ServerThemeProvider>
  );
}
