import { Link, useLocation, useParams } from "react-router-dom";
import type { ItemDetailsResponse } from "../../api/items";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { useItemDetail, useItemHistory } from "../../hooks/useItemDetail";
import dayjs from "../../utils/dayjs";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { PanelNavBar } from "../panel/PanelNav";
import { PencilIcon, TrashIcon } from "../panel/panelIcons";
import { ItemBackButton } from "./ItemBackButton";
import { ItemGallery } from "./ItemGallery";
import { ItemLoadStates } from "./ItemLoadStates";
import {
  FIELD_LABEL,
  MAX_PRODUCT_PHOTOS,
  NO_CATEGORY_LABEL,
  type HistoryState,
  type ItemCreatedState,
} from "./itemPageShared";
import { DescriptionText, ReadOnlyCards } from "./ItemReadOnlyParts";
import { useItemRoutes } from "./useItemRoutes";

/** `/product/:id`. Standalone, outside PanelDataProvider. */
export function ItemDetailPage() {
  return (
    <PhoneFrame>
      <ItemDetailBody />
      <PanelNavBar />
    </PhoneFrame>
  );
}

/** The item view inside a frame: two parallel reads, details and history. */
export function ItemDetailBody() {
  const { id = "" } = useParams();
  const { item, notFound, error, loading, refetch } = useItemDetail(id);
  const history = useItemHistory(id);

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
      <ItemBackButton />
      <FailedPhotosNotice />
      {item ? (
        <ItemViewContent item={item} history={history} />
      ) : (
        <ItemLoadStates notFound={notFound} error={error} loading={loading} onRetry={() => void refetch()} />
      )}
    </div>
  );
}

/** Shown right after `/product/new` when some photos were refused. */
export function FailedPhotosNotice() {
  const state = useLocation().state as ItemCreatedState | null;
  if (!state?.failedPhotos) return null;
  return (
    <div role="status" className="mb-3 rounded-[14px] border border-line bg-cream px-3.5 py-2.5 text-[12.5px] text-ink">
      {`Rzecz została dodana, ale nie udało się dodać części zdjęć (${state.failedPhotos}). ` +
        `Mogły się powtarzać albo przekroczyć limit ${MAX_PRODUCT_PHOTOS} zdjęć produktu — możesz je poprawić w edycji.`}
    </div>
  );
}

function ItemViewContent({ item, history }: { item: ItemDetailsResponse; history: HistoryState }) {
  const deleted = item.deleted_at !== null;
  const canEdit = item.is_owner && !deleted;
  const routes = useItemRoutes();

  return (
    <>
      {deleted && item.deleted_at && (
        <div role="status" className="mb-3 rounded-2xl bg-danger-soft p-[15px] text-danger">
          <p className="flex items-center gap-1.5 text-[13.5px] font-extrabold">
            <TrashIcon /> Rzecz usunięta
          </p>
          <p className="mt-0.5 text-[12.5px]">
            {`Ta rzecz została usunięta ${dayjs(item.deleted_at).format("DD.MM.YYYY")}. Możesz przejrzeć jej historię.`}
          </p>
        </div>
      )}
      <ItemGallery
        name={item.name}
        photos={item.photos}
        productPhotoUrl={item.product_photo_url}
        faded={deleted}
        showOwnerHint={canEdit}
      />
      <div className="mt-4 flex items-start justify-between gap-2.5">
        <h2 className="min-w-0 break-words text-[19px] font-semibold text-ink">{item.name}</h2>
        {canEdit && (
          <Link
            to={routes.editPath(item.id)}
            className="inline-flex flex-none items-center gap-1.5 rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft hover:text-ink"
          >
            <PencilIcon /> Edytuj
          </Link>
        )}
      </div>
      <p className="mt-0.5 text-[12.5px] text-ink-soft">
        {`${item.category_name ?? NO_CATEGORY_LABEL} · Stan: ${CONDITION_LABELS[item.condition]}`}
      </p>
      <section className="mt-4 rounded-[22px] border border-line bg-paper p-5" aria-labelledby="item-description-heading">
        <h3 id="item-description-heading" className={FIELD_LABEL}>
          Opis
        </h3>
        <DescriptionText description={item.description} />
      </section>
      <ReadOnlyCards item={item} history={history} />
    </>
  );
}
