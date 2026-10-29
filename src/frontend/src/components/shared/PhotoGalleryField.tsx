import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ModerationStatus } from "../../api/products";
import { ACCEPTED_PHOTO_TYPES } from "../../pages/product/itemPageShared";
import { TrashIcon } from "./appIcons";
import { PhotoPlaceholder } from "./Icons";

export type ModerationLabels = Record<Exclude<ModerationStatus, "APPROVED">, string>;

const STATUS_LABELS: ModerationLabels = {
  PENDING: "W moderacji",
  NEEDS_REVIEW: "Do sprawdzenia",
  REJECTED: "Odrzucone",
};

/** Owner-only marker on a photo others can't see yet. */
export function ModerationBadge({
  status,
  labels = STATUS_LABELS,
}: {
  status: ModerationStatus;
  labels?: ModerationLabels;
}) {
  if (status === "APPROVED") return null;
  const tone = status === "REJECTED" ? "bg-danger-soft text-danger" : "bg-cream text-ink-soft";
  return <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${tone}`}>{labels[status]}</span>;
}

interface PhotoFileFieldProps {
  disabled: boolean;
  label?: string;
  multiple?: boolean;
  /** Classes on the button-like label: spacing (default `mt-2`), a 44px touch height. */
  className?: string;
  onFiles: (files: File[]) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/** "+ Dodaj zdjęcia" by default — picks one or more image files (on phones
 * also the camera). Validation stays with the caller. */
export function PhotoFileField({
  disabled,
  label = "+ Dodaj zdjęcia",
  multiple = true,
  className = "mt-2",
  onFiles,
  inputRef,
}: PhotoFileFieldProps) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center rounded-[9px] bg-primary px-3 py-1.5 text-[11.5px] font-extrabold text-on-primary focus-within:ring-2 focus-within:ring-focus-ring/40 ${
        disabled ? "pointer-events-none opacity-60" : ""
      } ${className}`}
    >
      {label}
      <FileInput
        label={label.replace(/^\+\s*/, "")}
        multiple={multiple}
        disabled={disabled}
        onFiles={onFiles}
        inputRef={inputRef}
      />
    </label>
  );
}

function FileInput({
  label,
  multiple,
  disabled,
  onFiles,
  inputRef,
}: {
  label: string;
  multiple: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED_PHOTO_TYPES}
      multiple={multiple}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length > 0) onFiles(files);
      }}
      className="sr-only"
    />
  );
}

export interface GalleryPhoto {
  /** Stable key, also handed back to `onRemove`/`onMove`. */
  id: string;
  src: string;
  status?: ModerationStatus;
}

interface PhotoGalleryFieldProps {
  photos: GalleryPhoto[];
  /** With 1 the slider is a single wide banner. */
  max: number;
  disabled: boolean;
  /** Picked files; validation stays with the caller. */
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** Adds "earlier/later" buttons to every photo. */
  onMove?: (id: string, direction: "up" | "down") => void;
  /** Accessible noun of one photo: "Usuń zdjęcie 2", or "Usuń baner" when `max` is 1. */
  noun?: string;
  addLabel?: string;
  /** "create": while empty, one large "+" tile; "edit": an empty slider with the corner button. */
  variant?: "create" | "edit";
  /** Edge to edge at the top of a page whose content sheet overlaps the bottom 24px. */
  fullBleed?: boolean;
}

/** The shared photo editor: a slider with "Usuń" on every photo and the
 * main "Dodaj" button in its top corner; the "create" variant shows a large
 * "+" tile instead while empty. */
export function PhotoGalleryField({
  photos,
  max,
  disabled,
  onFiles,
  onRemove,
  onMove,
  noun = "zdjęcie",
  addLabel = "Dodaj zdjęcia",
  variant = "edit",
  fullBleed = false,
}: PhotoGalleryFieldProps) {
  const single = max === 1;
  const multiple = !single;
  // A rejected photo stays visible to its owner but doesn't use up the limit.
  const atLimit = photos.filter((p) => p.status !== "REJECTED").length >= max;
  // Follows the shown photo by id across reorders; after a removal the slider
  // stays at the same position.
  const [active, setActive] = useState<{ id: string | null; index: number }>({ id: null, index: 0 });
  const found = photos.findIndex((p) => p.id === active.id);
  const current = found !== -1 ? found : Math.min(active.index, Math.max(photos.length - 1, 0));
  const photo = photos[current];
  const focusAfterMove = useRef<"up" | "down" | null>(null);
  const moveUpRef = useRef<HTMLButtonElement>(null);
  const moveDownRef = useRef<HTMLButtonElement>(null);
  const shape = single ? "aspect-video" : "aspect-4/3";

  useEffect(() => {
    if (disabled || !focusAfterMove.current) return;
    const [target, fallback] =
      focusAfterMove.current === "up" ? [moveUpRef, moveDownRef] : [moveDownRef, moveUpRef];
    (target.current && !target.current.disabled ? target.current : fallback.current)?.focus();
    focusAfterMove.current = null;
  }, [disabled, photos]);

  if (photos.length === 0 && variant === "create") {
    return (
      <label
        className={`mt-2 flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line-strong bg-cream text-ink-soft hover:border-primary hover:text-ink focus-within:ring-2 focus-within:ring-focus-ring/40 ${shape} ${
          disabled ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <Plus size={48} strokeWidth={1.75} aria-hidden="true" />
        <span className="text-[13px] font-extrabold">{addLabel}</span>
        <FileInput label={addLabel} multiple={multiple} disabled={disabled} onFiles={onFiles} />
      </label>
    );
  }

  function show(index: number) {
    setActive({ id: photos[index].id, index });
  }

  function move(direction: "up" | "down") {
    if (!onMove || !photo) return;
    focusAfterMove.current = direction;
    onMove(photo.id, direction);
  }

  const name = single ? noun : `${noun} ${current + 1}`;
  const overlayButton =
    "flex h-10 items-center justify-center gap-1.5 rounded-full bg-paper/90 text-[13px] font-extrabold text-ink shadow-md hover:bg-paper focus-visible:outline-2 focus-visible:outline-focus-ring disabled:opacity-40";

  return (
    <div
      className={`relative overflow-hidden bg-primary-soft ${shape} ${fullBleed ? "" : "mt-2 rounded-2xl border border-line"}`}
    >
      {photo ? (
        <TileImage key={photo.src} src={photo.src} />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-2 pb-6 text-sm font-bold text-primary-fg">
          <PhotoPlaceholder size={48} />
          Brak zdjęć
        </span>
      )}

      {!atLimit ? (
        <PhotoFileField
          disabled={disabled}
          label={`+ ${addLabel}`}
          multiple={multiple}
          className={`absolute right-3 min-h-10 rounded-full px-4 text-[13px] shadow-md ${fullBleed ? "top-3.5" : "top-3"}`}
          onFiles={onFiles}
        />
      ) : (
        multiple && (
          <span
            className={`absolute right-3 rounded-full bg-paper/90 px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft shadow-md ${fullBleed ? "top-3.5" : "top-3"}`}
          >
            Osiągnięto limit {max} zdjęć
          </span>
        )
      )}

      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Poprzednie zdjęcie"
            disabled={current === 0}
            onClick={() => show(current - 1)}
            className={`absolute top-1/2 left-3 w-10 -translate-y-1/2 ${overlayButton}`}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Następne zdjęcie"
            disabled={current === photos.length - 1}
            onClick={() => show(current + 1)}
            className={`absolute top-1/2 right-3 w-10 -translate-y-1/2 ${overlayButton}`}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </>
      )}

      {photo && (
        <div className={`absolute inset-x-3 flex items-end justify-between gap-2 ${fullBleed ? "bottom-9" : "bottom-3"}`}>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {multiple && (
              <span className="rounded-full bg-paper/90 px-2.5 py-0.5 text-[11.5px] font-extrabold text-ink">
                {current + 1} / {photos.length}
              </span>
            )}
            {photo.status && <ModerationBadge status={photo.status} />}
          </span>
          <span className="flex flex-none gap-1.5">
            {onMove && (
              <>
                <button
                  ref={moveUpRef}
                  type="button"
                  aria-label={`Przesuń ${name} wcześniej`}
                  disabled={disabled || current === 0}
                  onClick={() => move("up")}
                  className={`w-10 ${overlayButton}`}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                </button>
                <button
                  ref={moveDownRef}
                  type="button"
                  aria-label={`Przesuń ${name} dalej`}
                  disabled={disabled || current === photos.length - 1}
                  onClick={() => move("down")}
                  className={`w-10 ${overlayButton}`}
                >
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(photo.id)}
              className={`px-3.5 hover:text-danger ${overlayButton}`}
            >
              <TrashIcon /> Usuń{" "}
              <span className="sr-only">{name}</span>
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Thumbnail filling its tile; a failed load shows the placeholder instead. */
function TileImage({ src }: { src: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) {
    return (
      <span className="flex h-full w-full items-center justify-center">
        <PhotoPlaceholder size={24} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className="h-full w-full object-cover"
    />
  );
}
