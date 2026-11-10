"use client";

import { PanelSectionError } from "../../../../../../features/panel/PanelRouteStates";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PanelSectionError reset={reset} />;
}
