import type { Metadata } from "next";
import { getItemOnServer } from "../../../../../api/server";
import { ItemChatButton } from "../../../../../features/items/product/blocks/ItemChatButton";
import { ItemDescription } from "../../../../../features/items/product/blocks/ItemDescription";
import { ItemHeader } from "../../../../../features/items/product/blocks/ItemHeader";
import { ItemHero } from "../../../../../features/items/product/blocks/ItemHero";
import { ItemLocation } from "../../../../../features/items/product/blocks/ItemLocation";
import { ItemOwner } from "../../../../../features/items/product/blocks/ItemOwner";
import { ItemPickupActions } from "../../../../../features/items/product/blocks/ItemPickupActions";
import { ItemPickupPlaces } from "../../../../../features/items/product/blocks/ItemPickupPlaces";
import { ItemStatus } from "../../../../../features/items/product/blocks/ItemStatus";
import { ItemPage, ItemSheet } from "../../../../../features/items/product/ItemPage";
import { itemMetadata } from "../../../../../lib/publicMetadata";

type Props = { params: Promise<{ slug: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return itemMetadata(await getItemOnServer((await params).id));
}

export default async function Page({ params }: Props) {
  const { slug, id } = await params;
  return (
    <ItemPage slug={slug} id={id}>
      <ItemHero />
      <ItemSheet>
        <ItemHeader />
        <ItemDescription />
        <ItemStatus />
        <ItemLocation />
        <ItemPickupPlaces />
        <ItemPickupActions />
        <ItemChatButton />
        <ItemOwner />
      </ItemSheet>
    </ItemPage>
  );
}
