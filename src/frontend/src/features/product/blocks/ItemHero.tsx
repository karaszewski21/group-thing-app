"use client";

import { ItemBackButton } from "../ItemBackButton";
import { ItemGallery } from "../ItemGallery";
import { useItemPage } from "../ItemPageContext";

/** Full-bleed gallery with the back button over it. */
export function ItemHero() {
  const { item } = useItemPage();
  const deleted = item.deleted_at !== null;
  return (
    <div className="relative">
      <ItemGallery
        name={item.name}
        photos={item.photos}
        productPhotoUrl={item.product_photo_url}
        faded={deleted}
        showOwnerHint={item.is_owner && !deleted}
      />
      <div className="absolute top-3.5 left-4">
        <ItemBackButton overlay />
      </div>
    </div>
  );
}
