import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import type { ListingStatus } from "../../api/inventories";
import type { ItemDetailsResponse } from "../../api/items";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import {
  useItemDetail,
  useItemEditing,
  useItemHistory,
  type ProductDetailsState,
} from "../../hooks/useItemDetail";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { BackIcon, PencilIcon } from "../../components/shared/appIcons";
import { ItemBackButton } from "./ItemBackButton";
import { ConditionEditor, DescriptionEditor, NameCategoryEditor } from "./ItemFieldEditors";
import { SafeImage } from "./ItemGallery";
import { ItemGalleryEditor, ItemPhotoStrip } from "./ItemGalleryEditor";
import { ItemLoadStates } from "./ItemLoadStates";
import {
  BACK_LINK,
  FIELD_LABEL,
  MAX_PRODUCT_PHOTOS,
  NO_CATEGORY_LABEL,
  PRIMARY_BTN,
  type HistoryState,
} from "./itemPageShared";
import { DescriptionText, ReadOnlyCards } from "./ItemReadOnlyParts";
import { useItemRoutes } from "./useItemRoutes";

type EditorKey = "photos" | "nameCategory" | "condition" | "description";

const LISTING_STATUS_CHIP: Record<ListingStatus, { label: string; className: string }> = {
  DRAFT: { label: "Wersja robocza", className: "bg-cream text-ink-soft" },
  ACTIVE: { label: "Aktywna", className: "bg-primary-soft text-primary-fg" },
};

/** `/product/:id/edit`. Standalone, outside AppDataProvider. */
export function ItemEditPage() {
  return (
    <PhoneFrame>
      <ItemEditBody />
    </PhoneFrame>
  );
}

/** The item editor inside a frame, owner only: a non-owner or a deleted
 * item goes back to the view. */
export function ItemEditBody() {
  const { id = "" } = useParams();
  const routes = useItemRoutes();
  const { item, notFound, error, loading, fetching, refetch } = useItemDetail(id);
  const history = useItemHistory(id);

  if (item && (!item.is_owner || item.deleted_at)) {
    return <Navigate to={routes.viewPath(id)} replace />;
  }

  return (
    <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
      {item ? (
        <>
          <Link to={routes.viewPath(id)} replace className={BACK_LINK}>
            <BackIcon /> Wróć do podglądu
          </Link>
          <ItemEditContent
            item={item}
            history={history}
            details={{ productId: item.product_id, fetching, failed: error !== null }}
            onRefetch={() => void refetch()}
          />
        </>
      ) : (
        <>
          <ItemBackButton />
          <ItemLoadStates notFound={notFound} error={error} loading={loading} onRetry={() => void refetch()} />
        </>
      )}
    </div>
  );
}

interface ItemEditContentProps {
  item: ItemDetailsResponse;
  history: HistoryState;
  details: ProductDetailsState;
  onRefetch: () => void;
}

function ItemEditContent({ item, history, details, onRefetch }: ItemEditContentProps) {
  const editing = useItemEditing(item.id, details);
  const routes = useItemRoutes();
  const productLocked = !editing.productEditable;
  const [openEditor, setOpenEditor] = useState<EditorKey | null>(null);
  const close = () => setOpenEditor(null);
  const chip = LISTING_STATUS_CHIP[item.listing_status];
  const field = (
    key: EditorKey,
    label: string,
    pencilLabel: string,
    value: ReactNode,
    editor: ReactNode,
    disabled = false,
  ) => (
    <EditableField
      label={label}
      pencilLabel={pencilLabel}
      open={openEditor === key}
      anyOpen={openEditor !== null}
      disabled={disabled}
      onOpen={() => setOpenEditor(key)}
      value={value}
      editor={editor}
    />
  );

  return (
    <>
      <div className="flex items-center justify-between gap-2.5">
        <h2 className="text-[19px] font-semibold text-ink">Edycja rzeczy</h2>
        <Link to={routes.viewPath(item.id)} replace className={PRIMARY_BTN}>
          Gotowe
        </Link>
      </div>
      <div data-testid="item-summary" className="mt-3 flex items-center gap-3">
        <SafeImage
          src={item.photos[0]?.thumb_url ?? item.product_photo_url ?? ""}
          alt=""
          className="h-14 w-14 flex-none rounded-2xl"
          placeholderSize={20}
        />
        <div className="min-w-0">
          <p className="break-words text-[15px] font-bold text-ink">{item.name}</p>
          <span
            className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold ${chip.className}`}
          >
            {chip.label}
          </span>
        </div>
      </div>
      {details.failed && !details.fetching && (
        <div role="alert" className="mt-3 rounded-[14px] border border-line bg-cream px-3.5 py-2.5 text-[12.5px] text-ink">
          Nie udało się wczytać aktualnych danych produktu — zdjęcia i opis są chwilowo zablokowane.{" "}
          <button type="button" onClick={onRefetch} className="font-extrabold text-primary-fg underline">
            Spróbuj ponownie
          </button>
        </div>
      )}
      <div className="mt-4 rounded-[22px] border border-line bg-paper p-5">
        {field(
          "photos",
          `Zdjęcia (${item.photos.length}/${MAX_PRODUCT_PHOTOS})`,
          "Edytuj zdjęcia",
          <ItemPhotoStrip photos={item.photos} />,
          <ItemGalleryEditor
            photos={item.photos}
            busy={editing.photoBusy}
            onAdd={editing.addPhoto}
            onRemove={editing.removePhoto}
            onMove={editing.movePhoto}
            onClose={close}
          />,
          productLocked,
        )}
      </div>
      <div className="mt-4 divide-y divide-line rounded-[22px] border border-line bg-paper px-5">
        {field(
          "nameCategory",
          "Nazwa i kategoria",
          "Edytuj nazwę i kategorię",
          <>
            <p className="mt-1 break-words text-[13.5px] font-semibold text-ink">{item.name}</p>
            <p className="text-[12.5px] text-ink-soft">{item.category_name ?? NO_CATEGORY_LABEL}</p>
          </>,
          <NameCategoryEditor item={item} onSave={editing.saveNameCategory} onClose={close} />,
        )}
        {field(
          "condition",
          "Stan",
          "Edytuj stan",
          <p className="mt-1 text-[13.5px] text-ink">{CONDITION_LABELS[item.condition]}</p>,
          <ConditionEditor item={item} onSave={editing.saveCondition} onClose={close} />,
        )}
        {field(
          "description",
          "Opis",
          "Edytuj opis",
          <DescriptionText description={item.description} />,
          <DescriptionEditor item={item} onSave={editing.saveDescription} onClose={close} />,
          productLocked,
        )}
      </div>
      <ReadOnlyCards item={item} history={history} />
    </>
  );
}

interface EditableFieldProps {
  label: string;
  pencilLabel: string;
  open: boolean;
  anyOpen: boolean;
  disabled: boolean;
  onOpen: () => void;
  value: ReactNode;
  editor: ReactNode;
}

/** A label row with its pencil. Focus moves into the editor on open and back
 * to the pencil when it closes (unless another editor took over). */
function EditableField({ label, pencilLabel, open, anyOpen, disabled, onOpen, value, editor }: EditableFieldProps) {
  const pencilRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open && !wasOpen.current) {
      editorRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    }
    if (!open && wasOpen.current && !anyOpen) {
      pencilRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open, anyOpen]);

  return (
    <div className="py-4 first:pt-0 last:pb-0 [&:only-child]:py-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className={FIELD_LABEL}>{label}</h3>
        {!open && (
          <button
            ref={pencilRef}
            type="button"
            aria-label={pencilLabel}
            disabled={disabled}
            onClick={onOpen}
            className="flex h-6 w-6 flex-none items-center justify-center rounded-[8px] text-ink-soft hover:bg-paper hover:text-ink disabled:opacity-40"
          >
            <PencilIcon />
          </button>
        )}
      </div>
      {open ? <div ref={editorRef}>{editor}</div> : value}
    </div>
  );
}
