import { useId } from "react";
import { Link } from "../../../routing/navigation";
import { itemPagePath } from "../../product/useItemRoutes";
import { itemsOf } from "../layouts/layoutData";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { ItemCard } from "../../../components/shared/ItemCard";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isRecentItemsEmpty(data: OrganizerPageData): boolean {
  return itemsOf(data.directory).length === 0;
}

/** The owner's newest listed items, each tile opening its product page.
 * `featured`: headed as the page's main offer, for a layout built around items. */
export function RecentItemsBlock({ data, variant }: BlockProps) {
  const headingId = useId();
  const items = itemsOf(data.directory);
  if (items.length === 0) return null;
  const slug = data.organization.slug;

  return (
    <section aria-labelledby={headingId} className="px-6 pt-6">
      <h2 id={headingId} className="mb-3 font-serif text-lg font-semibold text-ink">
        {variant === "featured" ? "Rzeczy do oddania i wymiany" : "Ostatnio dodane rzeczy"}
      </h2>
      <ul className="grid grid-cols-2 gap-2.5">
        {items.map((item) => (
          <li key={item.item_id}>
            <ItemCard
              href={itemPagePath(slug, item.item_id)}
              name={item.product_name}
              condition={item.condition}
              thumbUrl={item.thumb_url}
              mode={item.mode}
              reservation={item.reservation}
            />
          </li>
        ))}
      </ul>
      <Link
        to={`/${slug}/items`}
        className={`mt-1 flex min-h-[44px] items-center justify-center text-[13px] font-bold text-primary-fg ${FOCUS_RING}`}
      >
        {variant === "featured" ? "Zobacz wszystkie rzeczy →" : "Zobacz więcej →"}
      </Link>
    </section>
  );
}
