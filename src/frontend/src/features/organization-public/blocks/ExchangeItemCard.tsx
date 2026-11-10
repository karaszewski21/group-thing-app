import type { OrganizerExchangeItem } from "../../../api/groups";
import { ItemCard } from "../../../components/shared/ItemCard";
import { itemPagePath } from "../../product/useItemRoutes";

interface ExchangeItemCardProps {
  slug: string;
  item: OrganizerExchangeItem;
}

/** One exchange board item: the tile opens its product page. */
export function ExchangeItemCard({ slug, item }: ExchangeItemCardProps) {
  return (
    <ItemCard
      href={itemPagePath(slug, item.item_id)}
      name={item.product_name}
      condition={item.condition}
      thumbUrl={item.thumb_url}
      mode={item.mode}
      reservation={item.reservation}
    />
  );
}
