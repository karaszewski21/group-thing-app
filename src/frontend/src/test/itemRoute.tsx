import type { ReactElement } from "react";
import ItemRouteError from "../app/(site)/[slug]/product/[id]/error";
import ItemRouteNotFound from "../app/(site)/[slug]/product/[id]/not-found";
import ItemRoutePage from "../app/(site)/[slug]/product/[id]/page";
import OwnerItemsRouteError from "../app/(site)/[slug]/items/error";
import OwnerItemsRouteNotFound from "../app/(site)/[slug]/items/not-found";
import OwnerItemsRoutePage from "../app/(site)/[slug]/items/page";
import OwnerMeetingsRouteError from "../app/(site)/[slug]/meetings/error";
import OwnerMeetingsRouteNotFound from "../app/(site)/[slug]/meetings/not-found";
import OwnerMeetingsRoutePage from "../app/(site)/[slug]/meetings/page";
import OwnerRouteError from "../app/(site)/[slug]/error";
import OwnerRouteNotFound from "../app/(site)/[slug]/not-found";
import OwnerRoutePage from "../app/(site)/[slug]/page";
import AppearanceRouteError from "../app/(site)/[slug]/appearance/error";
import AppearanceRouteNotFound from "../app/(site)/[slug]/appearance/not-found";
import AppearanceRoutePage from "../app/(site)/[slug]/appearance/page";
import GroupTermsRouteError from "../app/(site)/[slug]/group/[groupId]/terms/error";
import GroupTermsRouteNotFound from "../app/(site)/[slug]/group/[groupId]/terms/not-found";
import GroupTermsRoutePage from "../app/(site)/[slug]/group/[groupId]/terms/page";
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
