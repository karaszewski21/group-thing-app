import type { Metadata } from "next";
import { getEventOnServer } from "../../../../../api/server";
import { EventAttendees } from "../../../../../features/events/blocks/EventAttendees";
import { EventBanner } from "../../../../../features/events/blocks/EventBanner";
import { EventChat } from "../../../../../features/events/blocks/EventChat";
import { EventDescription } from "../../../../../features/events/blocks/EventDescription";
import { EventHeader } from "../../../../../features/events/blocks/EventHeader";
import { EventInfo } from "../../../../../features/events/blocks/EventInfo";
import { EventLocation } from "../../../../../features/events/blocks/EventLocation";
import { EventRefreshError } from "../../../../../features/events/blocks/EventRefreshError";
import { EventSignUp } from "../../../../../features/events/blocks/EventSignUp";
import { EventPage } from "../../../../../features/events/EventPage";
import { eventMetadata } from "../../../../../lib/publicMetadata";
import { ServerThemeProvider } from "../../../../../theme/ServerThemeProvider";

type Props = { params: Promise<{ eventId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return eventMetadata(await getEventOnServer((await params).eventId));
}

export default async function Page({ params }: Props) {
  const { eventId } = await params;
  const organization = (await getEventOnServer(eventId))?.organization ?? null;
  const page = (
    <EventPage key={eventId} eventId={eventId}>
      <EventHeader />
      <div className="flex-1 pb-6">
        <EventBanner />
        <EventInfo />
        <EventDescription />
        <EventLocation />
        <EventChat />
        <EventAttendees />
        <EventRefreshError />
      </div>
      <EventSignUp />
    </EventPage>
  );
  if (organization === null) return page;
  return <ServerThemeProvider initialTheme={organization}>{page}</ServerThemeProvider>;
}
