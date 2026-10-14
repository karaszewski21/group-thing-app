import { Link, useLocation, useOutletContext, useParams } from "react-router-dom";
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
import { ItemPageSkeleton } from "./ItemPageSkeleton";
import {
  FIELD_LABEL,
  MAX_PRODUCT_PHOTOS,
  NO_CATEGORY_LABEL,
  type HistoryState,
  type ItemCreatedState,
} from "./itemPageShared";
import { DescriptionText } from "./ItemReadOnlyParts";
import { ItemHistoryCard, ItemStatusCard } from "./ItemTimeline";
import { useItemRoutes } from "./useItemRoutes";
import { familyInitials } from "../../components/shared/Avatar";
import type { PublicOrganizationResponse } from "../../api/organizations";

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

  if (item) {
    return (
      <div className="flex-1 overflow-y-auto pb-6">
        <ItemViewContent item={item} history={history} />
      </div>
    );
  }
  if (loading && !notFound && !error) {
    return (
      <div className="flex-1 overflow-y-auto pb-6">
        <ItemPageSkeleton />
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
      <ItemBackButton />
      <FailedPhotosNotice />
      <ItemLoadStates notFound={notFound} error={error} loading={loading} onRetry={() => void refetch()} />
    </div>
  );
}

/** On `/:organizationSlug/produkt/...`: a chip back to the organizer's page,
 * laid over the item photo. The organization comes from `OrganizerItemLayout`
 * (route outlet context), so this never fetches it again. */
function OrganizerChip({ organization }: { organization: PublicOrganizationResponse }) {
  return (
    <Link
      to={`/${organization.slug}`}
      className="flex min-h-10 max-w-[60%] items-center gap-2 rounded-full bg-paper py-1 pr-3.5 pl-1.5 text-[13px] font-bold text-ink shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      {organization.logo ? (
        <img src={organization.logo.thumb_url} alt="" className="h-7 w-7 flex-none rounded-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-[10px] bg-primary font-serif text-xs font-extrabold text-on-primary"
        >
          {familyInitials(organization.name)}
        </span>
      )}
      <span className="truncate">{organization.name}</span>
    </Link>
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

/** Full-bleed photo with the back button (and organizer chip) over it, then
 * the details on a rounded sheet that overlaps the photo's bottom edge. */
function ItemViewContent({ item, history }: { item: ItemDetailsResponse; history: HistoryState }) {
  const deleted = item.deleted_at !== null;
  const canEdit = item.is_owner && !deleted;
  const routes = useItemRoutes();
  // Set only under OrganizerItemLayout; `/product/:id` has no organizer.
  const organization = useOutletContext<PublicOrganizationResponse | null | undefined>();

  return (
    <>
      <div className="relative">
        <ItemGallery
          name={item.name}
          photos={item.photos}
          productPhotoUrl={item.product_photo_url}
          faded={deleted}
          showOwnerHint={canEdit}
        />
        <div className="absolute inset-x-4 top-3.5 flex items-start justify-between gap-3">
          <ItemBackButton overlay />
          {organization && <OrganizerChip organization={organization} />}
        </div>
      </div>
      <div className="relative -mt-6 rounded-t-[28px] bg-cream px-5 pt-6">
        <FailedPhotosNotice />
        {deleted && item.deleted_at && (
          <div role="status" className="mb-4 rounded-2xl bg-danger-soft p-[15px] text-danger">
            <p className="flex items-center gap-1.5 text-[13.5px] font-extrabold">
              <TrashIcon /> Rzecz usunięta
            </p>
            <p className="mt-0.5 text-[12.5px]">
              {`Ta rzecz została usunięta ${dayjs(item.deleted_at).format("DD.MM.YYYY")}. Możesz przejrzeć jej historię.`}
            </p>
          </div>
        )}
        <p className="text-sm text-ink-soft">
          {`${item.category_name ?? NO_CATEGORY_LABEL} · Stan: ${CONDITION_LABELS[item.condition]}`}
        </p>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h2 className="min-w-0 font-serif text-[30px] leading-tight font-extrabold tracking-tight wrap-break-word text-ink">
            {item.name}
          </h2>
          {canEdit && (
            <Link
              to={routes.editPath(item.id)}
              className="mt-1 inline-flex min-h-10 flex-none items-center gap-1.5 rounded-full border-[1.5px] border-line bg-paper px-3.5 text-[13px] font-extrabold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <PencilIcon /> Edytuj
            </Link>
          )}
        </div>
        <ItemStatusCard status={item.status} itemId={item.id} itemName={item.name} isOwner={item.is_owner} />
        <section className="mt-4 rounded-3xl border border-line bg-paper p-5" aria-labelledby="item-description-heading">
          <h3 id="item-description-heading" className={FIELD_LABEL}>
            Opis
          </h3>
          <DescriptionText description={item.description} />
        </section>
        <ItemHistoryCard
          entries={history.data}
          loading={history.loading}
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      </div>
    </>
  );
}
