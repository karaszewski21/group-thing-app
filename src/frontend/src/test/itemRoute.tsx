import type { ReactElement } from "react";
import ItemRouteError from "../app/(site)/[slug]/product/[id]/error";
import ItemRouteNotFound from "../app/(site)/[slug]/product/[id]/not-found";
import ItemRoutePage from "../app/(site)/[slug]/product/[id]/page";
import OwnerItemsRouteError from "../app/(site)/[slug]/items/error";
import OwnerItemsRouteNotFound from "../app/(site)/[slug]/items/not-found";
import OwnerItemsRoutePage from "../app/(site)/[slug]/items/page";
import { RouteBoundary } from "./routeBoundary";

/** `/:slug/product/:id` as Next renders it: the route's `page.tsx` block
 * tree inside its `error.tsx` and `not-found.tsx` boundaries. Render it on
 * the same URL, e.g. with `renderWithRoute(await itemRouteElement(url), { url, pattern })`. */
export async function itemRouteElement(url: string): Promise<ReactElement> {
  const [, slug = "", , id = ""] = new URL(url, "http://localhost").pathname.split("/");
  const page = await ItemRoutePage({ params: Promise.resolve({ slug, id }) });
  return (
    <RouteBoundary NotFound={ItemRouteNotFound} ErrorPage={ItemRouteError}>
      {page}
    </RouteBoundary>
  );
}

/** `/:slug/items` as Next renders it, like `itemRouteElement`. */
export async function ownerItemsRouteElement(url: string): Promise<ReactElement> {
  const [, slug = ""] = new URL(url, "http://localhost").pathname.split("/");
  const page = await OwnerItemsRoutePage({ params: Promise.resolve({ slug }) });
  return (
    <RouteBoundary NotFound={OwnerItemsRouteNotFound} ErrorPage={OwnerItemsRouteError}>
      {page}
    </RouteBoundary>
  );
}
