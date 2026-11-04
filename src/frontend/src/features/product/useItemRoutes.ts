import { useAppParams } from "../../routing/navigation";

/** An item's page under its owner's prefix: their Organization slug, else
 * their party id (`ownerSlug` of `ownerPagePath`). The page replaces a stale
 * prefix with the owner's current one. */
export function itemPagePath(ownerSlug: string, id: string): string {
  return `/${ownerSlug}/product/${id}`;
}

/** The owner's edit page in the panel (`ItemEditView`). */
export function itemEditPath(id: string): string {
  return `/items/${id}/edit`;
}

/** On `/:slug/product/:id`: where "Wróć" goes when the page was opened
 * directly — the owner's page under the same prefix. */
export function useItemBackFallback(): string {
  const { slug = "" } = useAppParams();
  return `/${slug}`;
}
