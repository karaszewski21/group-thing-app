"use client";

import { AppearanceError } from "../../../../features/editor/AppearanceFrame";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AppearanceError error={error} reset={reset} />;
}
