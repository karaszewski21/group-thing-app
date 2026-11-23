"use client";

import { EventPageError } from "../../../../../features/events/EventRouteStates";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <EventPageError error={error} reset={reset} />;
}
