import { useEffect, useRef } from "react";
import type { ItemDetailsResponse } from "../../api/items";
import { useItemDetail, useItemEditing, type ProductDetailsState } from "../../hooks/useItemDetail";
import { Link, useAppNavigate, useAppParams, useHasInAppHistory } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";
import { itemEditDraftFrom } from "../../utils/itemQuickAdd";
import { useAppData } from "../panel/appDataStore";
import { ItemEditForm } from "../product/ItemEditForm";
import { ItemGalleryEditor } from "../product/ItemGalleryEditor";
import { ItemLoadStates } from "../product/ItemLoadStates";
import { itemPagePath } from "../product/useItemRoutes";

const TITLE = "Edytuj rzecz";

/** `/items/:id/edit`: the owner edits an item in the panel — photos at the
 * top (each change saves at once), then name, condition, category,
 * description and place saved together. The typed values live in
 * AppDataContext (`itemEdit`, seeded once per item) so the place picker's
 * trip to /places/new keeps them; a save or "Anuluj" clears them. Both go
 * back where the owner came from (`/items` or the item page — the trip
 * replaces its history entries), or to `/items` when opened directly. */
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
  const { itemEdit, setItemEdit, refreshItems } = useAppData();
  const editing = useItemEditing(item.id, details, refreshItems);
  const draft = itemEdit?.itemId === item.id ? itemEdit.draft : null;
  // Set on save/cancel: the cleared draft must not be re-seeded (from the
  // not yet refreshed item) while the page is still mounted.
  const leaving = useRef(false);

  useEffect(() => {
    if (leaving.current || itemEdit?.itemId === item.id) return;
    setItemEdit({ itemId: item.id, draft: itemEditDraftFrom(item) });
  }, [item, itemEdit, setItemEdit]);

  const leave = () => {
    leaving.current = true;
    setItemEdit(null);
    onDone();
  };

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
        {draft && (
          <ItemEditForm
            item={item}
            editing={editing}
            draft={draft}
            onDraftChange={(next) => setItemEdit({ itemId: item.id, draft: next })}
            detailsFailed={details.failed && !details.fetching}
            onRetryDetails={onRefetch}
            onSaved={leave}
            onCancel={leave}
          />
        )}
      </div>
      <p className="mt-3 text-center text-[12.5px]">
        <Link to={itemHref} className="font-extrabold text-primary-fg underline">
          Zobacz stronę rzeczy →
        </Link>
      </p>
    </>
  );
}
