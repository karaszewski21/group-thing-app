import {
  Link,
  Navigate,
  useAppParams,
  useAppSearch,
  useNavigationState,
} from "../../../routing/navigation";
import type { ItemDetailsResponse } from "../../../api/items";
import { useAuth } from "../../../auth/AuthContext";
import { CARD } from "../../../components/shared/uiStyles";
import { AuthPromptButtons } from "../../auth/AuthSheet";
import { useItemActions, type UseItemActionsResult } from "../../../hooks/useItemActions";
import { useItemDetail } from "../../../hooks/useItemDetail";
import dayjs from "../../../utils/dayjs";
import { CONDITION_LABELS } from "../../../utils/productCategory";
import { PencilIcon, TrashIcon } from "../../../components/shared/appIcons";
import { ItemBackButton } from "./ItemBackButton";
import { ItemContextActions } from "./ItemContextActions";
import { resolveItemActionsView, type ItemActionsView } from "./itemActionsViewState";
import { ItemGallery } from "./ItemGallery";
import { ItemLoadStates } from "./ItemLoadStates";
import { ItemPageSkeleton } from "./ItemPageSkeleton";
import {
  FIELD_LABEL,
  MAX_PRODUCT_PHOTOS,
  NO_CATEGORY_LABEL,
  type ItemCreatedState,
} from "./itemPageShared";
import { DescriptionText } from "./ItemReadOnlyParts";
import { ItemStatusCard, type StatusReservation } from "./ItemStatusCard";
import { useOrganizerItemOrganization } from "./OrganizerItemContext";
import { itemEditPath, itemPagePath } from "./useItemRoutes";
import { ItemTileBadges } from "../../../components/shared/ItemTileBadges";
import type { ItemActionsResponse } from "../../../api/itemActions";
import { familyInitials } from "../../../components/shared/Avatar";
import type { PublicOrganizationResponse } from "../../../api/organizations";

/** `/:slug/product/:id` inside `OrganizerItemLayout`. Public for listed
 * items; an anonymous visitor whose item is not public (404) goes to login
 * and comes back. A prefix other than the owner's (their Organization slug,
 * else their party id) is replaced by the owner's. The owner edits the item
 * in the panel (`/items/:id/edit`). */
export function ItemDetailBody() {
  const { id = "", slug } = useAppParams();
  const search = useAppSearch();
  const isLoggedIn = useAuth().token !== null;
  const { item, notFound, error, loading, refetch } = useItemDetail(id);
  const actions = useItemActions(id);
  const owner = actions.data?.owner;
  const ownerSlug = owner ? (owner.slug ?? owner.party_id) : null;

  if (slug !== undefined && ownerSlug !== null && slug !== ownerSlug) {
    return <Navigate to={itemPagePath(ownerSlug, id) + search} replace />;
  }
  if (item) {
    return (
      <div className="flex-1 overflow-y-auto pb-6">
        <ItemViewContent item={item} actions={actions} isLoggedIn={isLoggedIn} />
      </div>
    );
  }
  if (notFound && !isLoggedIn) {
    return (
      <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
        <ItemBackButton />
        <section className={`mt-3 ${CARD}`}>
          <h2 className="text-[15px] font-extrabold text-ink">Zaloguj się, żeby zobaczyć tę rzecz</h2>
          <p className="mt-1 text-[13px] text-ink-soft">Ta rzecz nie jest publiczna albo już jej nie ma.</p>
          <AuthPromptButtons sheetMessage="Niektóre rzeczy widzą tylko zalogowani. Zaloguj się albo załóż konto — zostaniesz na tej stronie." />
        </section>
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
      {/* <ItemBackButton /> */}
      <FailedPhotosNotice />
      <ItemLoadStates notFound={notFound} error={error} loading={loading} onRetry={() => void refetch()} />
    </div>
  );
}

/** A chip back to the owner's Organization page,
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

/** Shown right after `/add/product` when some photos or the description were refused. */
export function FailedPhotosNotice() {
  const state = useNavigationState<ItemCreatedState>();
  if (!state?.failedPhotos && !state?.failedDescription) return null;
  return (
    <div role="status" className="mb-3 rounded-[14px] border border-line bg-cream px-3.5 py-2.5 text-[12.5px] text-ink">
      {state.failedPhotos > 0 && (
        <p>
          {`Rzecz została dodana, ale nie udało się dodać części zdjęć (${state.failedPhotos}). ` +
            `Mogły się powtarzać albo przekroczyć limit ${MAX_PRODUCT_PHOTOS} zdjęć produktu — możesz je poprawić w edycji.`}
        </p>
      )}
      {state.failedDescription && (
        <p>Rzecz została dodana, ale nie udało się zapisać opisu — możesz go dodać w edycji.</p>
      )}
    </div>
  );
}

interface ItemViewContentProps {
  item: ItemDetailsResponse;
  actions: UseItemActionsResult;
  isLoggedIn: boolean;
}

/** Full-bleed photo with the back button (and organizer chip) over it, then
 * the details on a rounded sheet that overlaps the photo's bottom edge. */
function ItemViewContent({ item, actions, isLoggedIn }: ItemViewContentProps) {
  const deleted = item.deleted_at !== null;
  const canEdit = item.is_owner && !deleted;
  const organization = useOrganizerItemOrganization();

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
        <div className="pointer-events-none absolute inset-x-4 top-3.5 flex items-start justify-between gap-3 *:pointer-events-auto">
          <ItemBackButton overlay />
          {organization && <OrganizerChip organization={organization} />}
        </div>
      </div>
      <div className="relative -mt-6 rounded-t-[28px] bg-cream px-5 pt-6">
        <FailedPhotosNotice />
        <ItemViewFields item={item} canEdit={canEdit} actions={actions} isLoggedIn={isLoggedIn} />
      </div>
    </>
  );
}

/** How the status card relates the viewer to the item's reservation: the
 * owner and a reservation party name both sides, anyone else is told it is
 * taken. `null` while not reserved or until the actions load. */
function statusReservation(view: ItemActionsView, actions: ItemActionsResponse | null): StatusReservation | null {
  const reservation = actions?.reservation ?? null;
  if (actions === null) return null;
  const party = { party: true as const, ownerName: actions.owner.display_name, reserverName: reservation?.by_name ?? null };
  if (view.kind === "own") return reservation ? party : null;
  if (view.kind !== "reserved") return null;
  return view.partyReservation ? party : { party: false };
}

interface ItemViewFieldsProps {
  item: ItemDetailsResponse;
  canEdit: boolean;
  actions: UseItemActionsResult;
  isLoggedIn: boolean;
}

/** The sheet's read-only fields (view mode). */
function ItemViewFields({ item, canEdit, actions, isLoggedIn }: ItemViewFieldsProps) {
  const view = resolveItemActionsView({
    item: { deleted: item.deleted_at !== null, isOwner: item.is_owner },
    detailsLoading: false,
    actions: actions.data,
    actionsLoading: actions.loading,
    actionsFetching: actions.fetching,
    actionsError: actions.error,
    isLoggedIn,
  });
  const mode = actions.data?.mode ?? null;
  const reservation = view.kind === "loading" ? null : (actions.data?.reservation ?? null);
  const isPrivate = view.kind === "own" && view.visibility === "PRIVATE";
  return (
    <>
      {item.deleted_at && (
        <div role="status" className="mb-4 rounded-2xl bg-danger-soft p-[15px] text-danger">
          <p className="flex items-center gap-1.5 text-[13.5px] font-extrabold">
            <TrashIcon /> Rzecz usunięta
          </p>
          <p className="mt-0.5 text-[12.5px]">
            {`Ta rzecz została usunięta ${dayjs(item.deleted_at).format("DD.MM.YYYY")}.`}
          </p>
        </div>
      )}
      {(mode || reservation || isPrivate) && view.kind !== "hidden" && (
        <p className="mb-1.5 flex flex-wrap gap-1">
          <ItemTileBadges modes={mode ? [mode] : []} reservation={reservation} size="md" />
          {isPrivate && (
            <>
              {" "}
              <span className="rounded-full bg-cream px-2.5 py-1 text-xs font-extrabold text-ink">🔒 Prywatny</span>
            </>
          )}
        </p>
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
            to={itemEditPath(item.id)}
            className="mt-1 inline-flex min-h-10 flex-none items-center gap-1.5 rounded-full border-[1.5px] border-line bg-paper px-3.5 text-[13px] font-extrabold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <PencilIcon /> Edytuj
          </Link>
        )}
      </div>
      <ItemStatusCard
        status={item.status}
        itemId={item.id}
        itemName={item.name}
        isOwner={item.is_owner}
        reservation={statusReservation(view, actions.data)}
        unlisted={view.kind === "own" && view.mode === null}
      />
      <ItemContextActions
        view={view}
        itemId={item.id}
        itemName={item.name}
        isLoggedIn={isLoggedIn}
        counterpartyName={item.status.counterparty_label}
        refetch={actions.refetch}
      />
      <section className="mt-4 rounded-3xl border border-line bg-paper p-5" aria-labelledby="item-description-heading">
        <h3 id="item-description-heading" className={FIELD_LABEL}>
          Opis
        </h3>
        <DescriptionText description={item.description} />
      </section>
    </>
  );
}
