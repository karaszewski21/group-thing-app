import { Component, type ReactElement, type ReactNode } from "react";
import ItemRouteError from "../app/(site)/[slug]/product/[id]/error";
import ItemRouteNotFound from "../app/(site)/[slug]/product/[id]/not-found";
import ItemRoutePage from "../app/(site)/[slug]/product/[id]/page";
import { NotFoundSentinel } from "./navigationMock";

/** `/:slug/product/:id` as Next renders it: the route's `page.tsx` block
 * tree inside its `error.tsx` and `not-found.tsx` boundaries. Render it on
 * the same URL, e.g. with `renderWithRoute(await itemRouteElement(url), { url, pattern })`. */
export async function itemRouteElement(url: string): Promise<ReactElement> {
  const [, slug = "", , id = ""] = new URL(url, "http://localhost").pathname.split("/");
  const page = await ItemRoutePage({ params: Promise.resolve({ slug, id }) });
  return <ItemRouteBoundary>{page}</ItemRouteBoundary>;
}

class ItemRouteBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (error instanceof NotFoundSentinel) return <ItemRouteNotFound />;
    return <ItemRouteError error={error} reset={() => this.setState({ error: null })} />;
  }
}
