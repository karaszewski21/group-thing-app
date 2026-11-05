"use client";

import { TermPageError } from "../../../../../../../features/terms/TermRouteStates";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <TermPageError reset={reset} />;
}
