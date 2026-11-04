import { OwnerItemsHeader } from "../../../../features/items/blocks/OwnerItemsHeader";
import { OwnerItemsList } from "../../../../features/items/blocks/OwnerItemsList";
import { OwnerItemsPickup } from "../../../../features/items/blocks/OwnerItemsPickup";
import { OwnerItemsPage } from "../../../../features/items/OwnerItemsPage";

type Props = { params: Promise<{ slug: string }> };

export default async function Page({ params }: Props) {
  const { slug } = await params;
  return (
    <OwnerItemsPage slug={slug}>
      <OwnerItemsHeader />
      <OwnerItemsPickup />
      <OwnerItemsList />
    </OwnerItemsPage>
  );
}
