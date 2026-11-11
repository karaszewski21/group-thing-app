"use client";

import { GroupTermsError } from "../../../../../../features/group-terms/GroupTermsRouteStates";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <GroupTermsError error={error} reset={reset} />;
}
