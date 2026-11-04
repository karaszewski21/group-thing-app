"use client";

import { ItemPageError } from "../../../../../features/items/product/ItemRouteStates";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ItemPageError error={error} reset={reset} />;
}
