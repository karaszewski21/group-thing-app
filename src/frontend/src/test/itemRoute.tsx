import type { ReactElement } from "react";
import ItemRouteError from "../app/(public)/[slug]/product/[id]/error";
import ItemRouteNotFound from "../app/(public)/[slug]/product/[id]/not-found";
import ItemRoutePage from "../app/(public)/[slug]/product/[id]/page";
import OwnerItemsRouteError from "../app/(public)/[slug]/items/error";
import OwnerItemsRouteNotFound from "../app/(public)/[slug]/items/not-found";
import OwnerItemsRoutePage from "../app/(public)/[slug]/items/page";
import OwnerMeetingsRouteError from "../app/(public)/[slug]/meetings/error";
import OwnerMeetingsRouteNotFound from "../app/(public)/[slug]/meetings/not-found";
import OwnerMeetingsRoutePage from "../app/(public)/[slug]/meetings/page";
import OwnerRouteError from "../app/(public)/[slug]/error";
import OwnerRouteNotFound from "../app/(public)/[slug]/not-found";
import OwnerRoutePage from "../app/(public)/[slug]/page";
import AppearanceRouteError from "../app/(public)/[slug]/appearance/error";
import AppearanceRouteNotFound from "../app/(public)/[slug]/appearance/not-found";
import AppearanceRoutePage from "../app/(public)/[slug]/appearance/page";
import GroupTermsRouteError from "../app/(public)/[slug]/group/[groupId]/terms/error";
import GroupTermsRouteNotFound from "../app/(public)/[slug]/group/[groupId]/terms/not-found";
import GroupTermsRoutePage from "../app/(public)/[slug]/group/[groupId]/terms/page";
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

/** `/:slug/meetings` as Next renders it, like `itemRouteElement`. */
export async function ownerMeetingsRouteElement(url: string): Promise<ReactElement> {
  const [, slug = ""] = new URL(url, "http://localhost").pathname.split("/");
  const page = await OwnerMeetingsRoutePage({ params: Promise.resolve({ slug }) });
  return (
    <RouteBoundary NotFound={OwnerMeetingsRouteNotFound} ErrorPage={OwnerMeetingsRouteError}>
      {page}
    </RouteBoundary>
  );
}

/** `/:slug/group/:groupId/terms` as Next renders it, like `itemRouteElement`. */
export async function groupTermsRouteElement(url: string): Promise<ReactElement> {
  const [, slug = "", , groupId = ""] = new URL(url, "http://localhost").pathname.split("/");
  const page = await GroupTermsRoutePage({ params: Promise.resolve({ slug, groupId }) });
  return (
    <RouteBoundary NotFound={GroupTermsRouteNotFound} ErrorPage={GroupTermsRouteError}>
      {page}
    </RouteBoundary>
  );
}

/** `/:slug` (an Organization's page or a person's profile) as Next renders
 * it, like `itemRouteElement`. */
export async function ownerRouteElement(url: string): Promise<ReactElement> {
  const [, slug = ""] = new URL(url, "http://localhost").pathname.split("/");
  const page = await OwnerRoutePage({ params: Promise.resolve({ slug }) });
  return (
    <RouteBoundary NotFound={OwnerRouteNotFound} ErrorPage={OwnerRouteError}>
      {page}
    </RouteBoundary>
  );
}

/** `/:slug/appearance` (an Organization's or a person's "Wygląd strony") as
 * Next renders it, like `itemRouteElement`. */
export async function appearanceRouteElement(url: string): Promise<ReactElement> {
  const [, slug = ""] = new URL(url, "http://localhost").pathname.split("/");
  const page = await AppearanceRoutePage({ params: Promise.resolve({ slug }) });
  return (
    <RouteBoundary NotFound={AppearanceRouteNotFound} ErrorPage={AppearanceRouteError}>
      {page}
    </RouteBoundary>
  );
}
