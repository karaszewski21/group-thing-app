"use client";

import { FIELD_LABEL, ITEM_SECTION } from "../../product/itemPageShared";
import { useTermPage } from "../TermPageContext";

/** The term's description, styled like the item page's; nothing without one. */
export function TermDescription() {
  const description = useTermPage().view.group.term?.description;
  if (!description) return null;
  return (
    <section className={`mx-5 ${ITEM_SECTION}`} aria-labelledby="term-description-heading">
      <h2 id="term-description-heading" className={FIELD_LABEL}>
        Opis
      </h2>
      <p className="mt-1.5 whitespace-pre-line wrap-break-word text-[13.5px] text-ink">{description}</p>
    </section>
  );
}
