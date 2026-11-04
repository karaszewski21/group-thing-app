"use client";

import { ItemTileBadges } from "../../../components/shared/ItemTileBadges";
import { TrashIcon } from "../../../components/shared/appIcons";
import { useNavigationState } from "../../../routing/navigation";
import dayjs from "../../../utils/dayjs";
import { CONDITION_LABELS } from "../../../utils/productCategory";
import { useItemPage } from "../ItemPageContext";
import { MAX_PRODUCT_PHOTOS, NO_CATEGORY_LABEL, type ItemCreatedState } from "../itemPageShared";
import { ItemStatusPill } from "./ItemStatus";

/** The top of the sheet: the create-page notice, the deleted banner, the
 * listing badges ("Chcę oddać" / "Chcę się zamienić", the reservation, the
 * owner's "Prywatny", a bare "Dostępna" status), the category with the
 * condition, and the name. */
export function ItemHeader() {
  const { item, actions, view, statusAsPill } = useItemPage();
  const mode = view.kind === "hidden" ? null : (actions.data?.mode ?? null);
  const reservation = view.kind === "loading" || view.kind === "hidden" ? null : (actions.data?.reservation ?? null);
  const isPrivate = view.kind === "own" && view.visibility === "PRIVATE";
  return (
    <>
      <FailedPhotosNotice />
      {item.deleted_at !== null && (
        <div role="status" className="mb-4 rounded-2xl bg-danger-soft p-3.75 text-danger">
          <p className="flex items-center gap-1.5 text-[13.5px] font-extrabold">
            <TrashIcon /> Rzecz usunięta
          </p>
          <p className="mt-0.5 text-[12.5px]">{`Ta rzecz została usunięta ${dayjs(item.deleted_at).format("DD.MM.YYYY")}.`}</p>
        </div>
      )}
      {(mode || reservation || isPrivate || statusAsPill) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          <ItemTileBadges modes={mode ? [mode] : []} reservation={reservation} size="md" />
          {isPrivate && (
            <>
              {" "}
              <span className="rounded-full bg-cream px-2.5 py-1 text-xs font-extrabold text-ink">🔒 Prywatny</span>
            </>
          )}
          {statusAsPill && <ItemStatusPill status={item.status} />}
        </div>
      )}
      <p className="text-sm text-ink-soft">
        {`${item.category_name ?? NO_CATEGORY_LABEL} · Stan: ${CONDITION_LABELS[item.condition]}`}
      </p>
      <h2 className="mt-1 font-serif text-[30px] leading-tight font-extrabold tracking-tight wrap-break-word text-ink">
        {item.name}
      </h2>
    </>
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
