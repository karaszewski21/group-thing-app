"use client";

import { OwnerItemsError } from "../../../../features/items/OwnerItemsRouteStates";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <OwnerItemsError error={error} reset={reset} />;
}
