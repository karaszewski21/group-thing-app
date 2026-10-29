import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ModerationStatus, ProductPhotoResponse } from "../../api/products";
import { TrashIcon } from "../../components/shared/appIcons";
import { SafeImage } from "./ItemGallery";
import { ACCEPTED_PHOTO_TYPES, MAX_PRODUCT_PHOTOS, photoFileError } from "./itemPageShared";

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
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${tone}`}>
      {labels[status]}
    </span>
  );
}


interface ItemGalleryEditorProps {
  photos: ProductPhotoResponse[];
  busy: boolean;
  onAdd: (file: File) => Promise<void>;
  onRemove: (photoId: string) => Promise<void>;
  onMove: (photoId: string, direction: "up" | "down") => Promise<void>;
}

/** Each photo on its own row (move up/down, remove) plus adding new ones.
 * Every action saves immediately; all controls are disabled while a photo
 * call and its follow-up refetch are pending, so a reorder never works from
 * a stale order. */
export function ItemGalleryEditor({ photos, busy, onAdd, onRemove, onMove }: ItemGalleryEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const focusAfterMove = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());
  const activeCount = photos.filter((p) => p.status !== "REJECTED").length;
  const atLimit = activeCount >= MAX_PRODUCT_PHOTOS;

  useEffect(() => {
    if (busy || !focusAfterMove.current) return;
    const { id, dir } = focusAfterMove.current;
    const other = dir === "up" ? "down" : "up";
    const target = moveButtons.current.get(`${id}-${dir}`);
    const fallback = moveButtons.current.get(`${id}-${other}`);
    (target && !target.disabled ? target : fallback)?.focus();
    focusAfterMove.current = null;
  }, [busy, photos]);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleFiles(files: File[]) {
    const invalid = files.map(photoFileError).find((message) => message !== null);
    if (invalid) {
      setError(invalid);
      return;
    }
    void run(async () => {
      for (const file of files.slice(0, MAX_PRODUCT_PHOTOS - activeCount)) {
        await onAdd(file);
      }
    });
  }

  function handleMove(id: string, dir: "up" | "down") {
    void run(async () => {
      focusAfterMove.current = { id, dir };
      await onMove(id, dir);
    });
  }

  const iconButton =
    "flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-ink-soft hover:bg-paper hover:text-ink disabled:opacity-40";

  return (
    <div className="mt-2">
      {photos.length > 0 && (
        <ul className="space-y-2">
          {photos.map((p, i) => {
            const n = i + 1;
            return (
              <li key={p.id} className="flex items-center gap-2 rounded-2xl border border-line bg-cream p-2">
                <SafeImage src={p.thumb_url} alt="" className="h-12 w-12 flex-none rounded-xl" placeholderSize={20} />
                <span className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-ink">
                  Zdjęcie {n}
                  <ModerationBadge status={p.status} />
                </span>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) moveButtons.current.set(`${p.id}-up`, el);
                    else moveButtons.current.delete(`${p.id}-up`);
                  }}
                  aria-label={`Przesuń zdjęcie ${n} w górę`}
                  disabled={busy || i === 0}
                  onClick={() => handleMove(p.id, "up")}
                  className={iconButton}
                >
                  <ChevronUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) moveButtons.current.set(`${p.id}-down`, el);
                    else moveButtons.current.delete(`${p.id}-down`);
                  }}
                  aria-label={`Przesuń zdjęcie ${n} w dół`}
                  disabled={busy || i === photos.length - 1}
                  onClick={() => handleMove(p.id, "down")}
                  className={iconButton}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Usuń zdjęcie ${n}`}
                  disabled={busy}
                  onClick={() => void run(() => onRemove(p.id))}
                  className={`${iconButton} hover:text-danger`}
                >
                  <TrashIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <PhotoFileField disabled={busy || atLimit} onFiles={handleFiles} />
      {atLimit && <p className="mt-1.5 text-[12.5px] text-ink-soft">Osiągnięto limit {MAX_PRODUCT_PHOTOS} zdjęć.</p>}
      <p className="mt-1.5 text-[11.5px] text-ink-soft">
        Zdjęcia są wspólne dla wszystkich rzeczy tego produktu. Inni zobaczą je po sprawdzeniu.
      </p>
      {error && (
        <p role="alert" className="mt-1.5 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

interface PhotoFileFieldProps {
  disabled: boolean;
  label?: string;
  multiple?: boolean;
  /** Extra classes on the button-like label, e.g. a 44px touch height. */
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
  className = "",
  onFiles,
  inputRef,
}: PhotoFileFieldProps) {
  return (
    <label
      className={`mt-2 inline-flex cursor-pointer items-center rounded-[9px] bg-primary px-3 py-1.5 text-[11.5px] font-extrabold text-on-primary focus-within:ring-2 focus-within:ring-focus-ring/40 ${
        disabled ? "pointer-events-none opacity-60" : ""
      } ${className}`}
    >
      {label}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_PHOTO_TYPES}
        multiple={multiple}
        aria-label={label.replace(/^\+\s*/, "")}
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
        className="sr-only"
      />
    </label>
  );
}
