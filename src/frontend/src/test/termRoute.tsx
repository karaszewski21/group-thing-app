import type { ReactElement } from "react";
import TermRouteError from "../app/(site)/[slug]/group/[groupId]/term/[termId]/error";
import TermRouteNotFound from "../app/(site)/[slug]/group/[groupId]/term/[termId]/not-found";
import TermRoutePage from "../app/(site)/[slug]/group/[groupId]/term/[termId]/page";
import { RouteBoundary } from "./routeBoundary";

/** `/:slug/group/:groupId/term/:termId` as Next renders it, like
 * `itemRouteElement`. The page reads the circle on the server, so a test file
 * mocks `getPublicCircleOnServer` from `api/server`. */
export async function termRouteElement(url: string): Promise<ReactElement> {
  const [, , , groupId = "", , termId = ""] = new URL(url, "http://localhost").pathname.split("/");
  const page = await TermRoutePage({ params: Promise.resolve({ groupId, termId }) });
  return (
    <RouteBoundary NotFound={TermRouteNotFound} ErrorPage={TermRouteError}>
      {page}
    </RouteBoundary>
  );
}
