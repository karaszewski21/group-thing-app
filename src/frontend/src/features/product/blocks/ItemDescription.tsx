"use client";

import { useItemPage } from "../ItemPageContext";
import { FIELD_LABEL, ITEM_SECTION } from "../itemPageShared";

export function ItemDescription() {
  const { item } = useItemPage();
  return (
    <section className={ITEM_SECTION} aria-labelledby="item-description-heading">
      <h3 id="item-description-heading" className={FIELD_LABEL}>
        Opis
      </h3>
      {item.description ? (
        <p className="mt-1.5 whitespace-pre-line wrap-break-word text-[13.5px] text-ink">{item.description}</p>
      ) : (
        <p className="mt-1.5 text-[13.5px] italic text-ink-soft">Właściciel nie dodał opisu.</p>
      )}
    </section>
  );
}
