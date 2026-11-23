"use client";

import { OwnerMeetingsError } from "../../../../features/meetings/OwnerMeetingsRouteStates";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <OwnerMeetingsError error={error} reset={reset} />;
}
