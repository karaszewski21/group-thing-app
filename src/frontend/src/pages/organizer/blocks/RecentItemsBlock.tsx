import { useId } from "react";
import { Link } from "react-router-dom";
import { organizerItemPath } from "../../product/useItemRoutes";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { ItemCard } from "./ExchangeItemCard";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isRecentItemsEmpty(data: OrganizerPageData): boolean {
  return (data.directory?.recent_items.length ?? 0) === 0;
}

/** The owner's newest listed items, each tile opening its product page. */
export function RecentItemsBlock({ data }: BlockProps) {
  const headingId = useId();
  const directory = data.directory;
  if (!directory || directory.recent_items.length === 0) return null;
  const slug = data.organization.slug;

  return (
    <section aria-labelledby={headingId} className="px-6 pt-6">
      <h2 id={headingId} className="mb-3 font-serif text-lg font-semibold text-ink">
        Ostatnio dodane rzeczy
      </h2>
      <ul className="grid grid-cols-2 gap-2.5">
        {directory.recent_items.map((item) => (
          <li key={item.item_id}>
            <ItemCard
              href={organizerItemPath(slug, item.item_id)}
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
        Zobacz więcej →
      </Link>
    </section>
  );
}
