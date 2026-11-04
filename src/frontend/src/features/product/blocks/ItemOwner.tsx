"use client";

import { Avatar } from "../../../components/shared/Avatar";
import { CARD } from "../../../components/shared/uiStyles";
import { Link } from "../../../routing/navigation";
import { ownerPagePath } from "../../../routing/paths";
import { useItemPage } from "../ItemPageContext";

/** The owner with a link to all their listed items; not on the owner's own view. */
export function ItemOwner() {
  const { view } = useItemPage();
  if (view.kind === "loading" || view.kind === "hidden" || view.kind === "error" || view.kind === "own") return null;
  const { owner } = view;
  return (
    <section className={`mt-3 flex items-center gap-3 ${CARD}`} aria-label="Właściciel">
      <Avatar name={owner.display_name} size="md" />
      <div className="min-w-0">
        <Link
          to={ownerPagePath(owner)}
          className="block truncate text-sm font-extrabold text-ink no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {owner.display_name}
        </Link>
        <Link
          to={`/${owner.slug ?? owner.party_id}/items`}
          className="text-[13px] font-extrabold text-primary-fg no-underline"
        >
          {`Zobacz wszystkie rzeczy (${owner.items_total}) ›`}
        </Link>
      </div>
    </section>
  );
}
