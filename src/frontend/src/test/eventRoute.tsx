import type { ReactElement } from "react";
import EventRouteError from "../app/(site)/[slug]/event/[eventId]/error";
import EventRouteNotFound from "../app/(site)/[slug]/event/[eventId]/not-found";
import EventRoutePage from "../app/(site)/[slug]/event/[eventId]/page";
import { RouteBoundary } from "./routeBoundary";

/** `/:slug/event/:eventId` as Next renders it, like `itemRouteElement`. The
 * page reads the event on the server, so a test file mocks `getEventOnServer`
 * from `api/server`. */
export async function eventRouteElement(url: string): Promise<ReactElement> {
  const [, , , eventId = ""] = new URL(url, "http://localhost").pathname.split("/");
  const page = await EventRoutePage({ params: Promise.resolve({ eventId }) });
  return (
    <RouteBoundary NotFound={EventRouteNotFound} ErrorPage={EventRouteError}>
      {page}
    </RouteBoundary>
  );
}
