import type { ItemDetailsResponse } from "../../api/items";
import { SubPageHeader } from "../../components/shared/appComponents";
import { useItemDetail, useItemEditing, type ProductDetailsState } from "../../hooks/useItemDetail";
import { Link, useAppNavigate, useAppParams, useHasInAppHistory } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";
import { useAppData } from "../panel/appDataStore";
import { ItemEditForm } from "./product/ItemEditForm";
import { ItemGalleryEditor } from "./product/ItemGalleryEditor";
import { ItemLoadStates } from "./product/ItemLoadStates";
import { itemPagePath } from "./product/useItemRoutes";

const TITLE = "Edytuj rzecz";

/** `/items/:id/edit`: the owner edits an item in the panel — photos at the
 * top (each change saves at once), then name, condition, category and
 * description saved together. "Zapisz" and "Anuluj" go back where the owner
 * came from (`/items` or the item page), or to `/items` when opened directly. */
export function ItemEditView() {
  const { id = "" } = useAppParams();
  const navigate = useAppNavigate();
  const hasInAppHistory = useHasInAppHistory();
  const { ownSlug } = useAppData();
  const { item, notFound, error, loading, fetching, refetch } = useItemDetail(id);

  const done = () => {
    if (hasInAppHistory) navigate(-1);
    else navigate(viewPath("items"));
  };

  return (
    <section aria-label={TITLE}>
      <SubPageHeader title={TITLE} backTo={viewPath("items")} backLabel="Wróć do moich rzeczy" />
      {!item ? (
        <ItemLoadStates notFound={notFound} error={error} loading={loading} onRetry={() => void refetch()} />
      ) : !item.is_owner || item.deleted_at !== null ? (
        <p className="rounded-[22px] border border-line bg-paper p-5 text-sm text-ink-soft">
          Tej rzeczy nie możesz edytować.
        </p>
      ) : (
        <ItemEditContent
          item={item}
          details={{ productId: item.product_id, fetching, failed: error !== null }}
          onRefetch={() => void refetch()}
          onDone={done}
          itemHref={itemPagePath(ownSlug, item.id)}
        />
      )}
    </section>
  );
}

interface ItemEditContentProps {
  item: ItemDetailsResponse;
  details: ProductDetailsState;
  onRefetch: () => void;
  onDone: () => void;
  itemHref: string;
}

function ItemEditContent({ item, details, onRefetch, onDone, itemHref }: ItemEditContentProps) {
  const editing = useItemEditing(item.id, details);
  return (
    <>
      <div className="overflow-hidden rounded-[22px]">
        <ItemGalleryEditor
          photos={item.photos}
          busy={editing.photoBusy || !editing.productEditable}
          onAdd={editing.addPhoto}
          onRemove={editing.removePhoto}
          onMove={editing.movePhoto}
        />
      </div>
      <div className="mt-4 rounded-[22px] border border-line bg-paper p-5">
        <ItemEditForm
          item={item}
          editing={editing}
          detailsFailed={details.failed && !details.fetching}
          onRetryDetails={onRefetch}
          onDone={onDone}
        />
      </div>
      <p className="mt-3 text-center text-[12.5px]">
        <Link to={itemHref} className="font-extrabold text-primary-fg underline">
          Zobacz stronę rzeczy →
        </Link>
      </p>
    </>
  );
}
