import type { ItemDetailsResponse } from "../../api/items";
import { itemPagePath } from "./useItemRoutes";

/** The one screen `/:slug/product/:id` shows. `notFound` and `error` are
 * handed to the route's `not-found.tsx` and `error.tsx`; an anonymous visitor
 * whose item is not public gets `loginRequired` in place instead. */
export type ItemPageView =
  | { kind: "loading" }
  | { kind: "redirect"; to: string }
  | { kind: "content"; item: ItemDetailsResponse }
  | { kind: "loginRequired" }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

interface ItemPageState {
  slug: string;
  id: string;
  /** The current query string (`?event=…`), kept across the redirect. */
  search: string;
  /** The owner's prefix from the actions: Organization slug, else party id. */
  ownerSlug: string | null;
  item: ItemDetailsResponse | null;
  notFound: boolean;
  error: string | null;
  isLoggedIn: boolean;
}

/** First match wins: a prefix other than the owner's is replaced by theirs,
 * loaded details show even while a refetch fails, and a 404 asks an
 * anonymous visitor to log in (the item may be visible to them then). */
export function resolveItemPageView({
  slug,
  id,
  search,
  ownerSlug,
  item,
  notFound,
  error,
  isLoggedIn,
}: ItemPageState): ItemPageView {
  if (ownerSlug !== null && slug !== ownerSlug) return { kind: "redirect", to: itemPagePath(ownerSlug, id) + search };
  if (item) return { kind: "content", item };
  if (notFound) return isLoggedIn ? { kind: "notFound" } : { kind: "loginRequired" };
  if (error) return { kind: "error", message: error };
  return { kind: "loading" };
}
