"use client";

import { SearchPageError } from "../../../features/search/SearchRouteStates";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SearchPageError reset={reset} />;
}
