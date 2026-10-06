import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ModerationStatus, ProductPhotoResponse } from "../../api/products";
import { TrashIcon } from "../panel/panelIcons";
import { SafeImage } from "./ItemGallery";
import { ACCEPTED_PHOTO_TYPES, MAX_PRODUCT_PHOTOS, photoFileError } from "./itemPageShared";

const STATUS_LABELS: Record<Exclude<ModerationStatus, "APPROVED">, string> = {
  PENDING: "W moderacji",
  NEEDS_REVIEW: "Do sprawdzenia",
  REJECTED: "Odrzucone",
};

/** Owner-only marker on a photo others can't see yet. */
export function ModerationBadge({ status }: { status: ModerationStatus }) {
  if (status === "APPROVED") return null;
  const tone = status === "REJECTED" ? "bg-danger-soft text-danger" : "bg-cream text-ink-soft";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${tone}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}


/** Idle edit-mode preview of the photo row. */
export function ItemPhotoStrip({ photos }: { photos: ProductPhotoResponse[] }) {
  if (photos.length === 0) {
    return <p className="mt-1 text-[12.5px] italic text-ink-soft">Brak zdjęć</p>;
  }
  return (
    <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
      {photos.map((p) => (
        <SafeImage
          key={p.id}
          src={p.thumb_url}
          alt=""
          className="h-12 w-12 flex-none rounded-xl"
          placeholderSize={20}
        />
      ))}
    </div>
  );
}

interface ItemGalleryEditorProps {
  photos: ProductPhotoResponse[];
  busy: boolean;
  onAdd: (file: File) => Promise<void>;
  onRemove: (photoId: string) => Promise<void>;
  onMove: (photoId: string, direction: "up" | "down") => Promise<void>;
  onClose: () => void;
}

/** Every action saves immediately; all controls are disabled while a photo
 * call and its follow-up refetch are pending, so a reorder never works from
 * a stale order. */
export function ItemGalleryEditor({ photos, busy, onAdd, onRemove, onMove, onClose }: ItemGalleryEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const focusAfterMove = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());
  const inputRef = useRef<HTMLInputElement>(null);
  const activeCount = photos.filter((p) => p.status !== "REJECTED").length;
  const atLimit = activeCount >= MAX_PRODUCT_PHOTOS;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      <PhotoFileField inputRef={inputRef} disabled={busy || atLimit} onFiles={handleFiles} onEscape={onClose} />
      {atLimit && <p className="mt-1.5 text-[12.5px] text-ink-soft">Osiągnięto limit {MAX_PRODUCT_PHOTOS} zdjęć.</p>}
      <p className="mt-1.5 text-[11.5px] text-ink-soft">
        Zdjęcia są wspólne dla wszystkich rzeczy tego produktu. Inni zobaczą je po sprawdzeniu. Nowe zdjęcie
        zdejmuje te rzeczy z terminów do czasu jego zatwierdzenia.
      </p>
      {error && (
        <p role="alert" className="mt-1.5 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-2.5 rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft"
      >
        Gotowe
      </button>
    </div>
  );
}

interface PhotoFileFieldProps {
  disabled: boolean;
  onFiles: (files: File[]) => void;
  onEscape?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/** "+ Dodaj zdjęcia" — picks one or more image files (on phones also the
 * camera). Validation stays with the caller. */
export function PhotoFileField({ disabled, onFiles, onEscape, inputRef }: PhotoFileFieldProps) {
  return (
    <label
      className={`mt-2 inline-flex cursor-pointer items-center rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white focus-within:ring-2 focus-within:ring-mint/40 ${
        disabled ? "pointer-events-none opacity-60" : ""
      }`}
    >
      + Dodaj zdjęcia
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_PHOTO_TYPES}
        multiple
        aria-label="Dodaj zdjęcia"
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onEscape?.();
        }}
        className="sr-only"
      />
    </label>
  );
}
