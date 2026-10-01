import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProductPhotoResponse } from "../../api/products";
import { isValidImageUrl } from "../../utils/url";
import { TrashIcon } from "../panel/panelIcons";
import { SafeImage } from "./ItemGallery";
import { MAX_PRODUCT_PHOTOS } from "./itemPageShared";

const INVALID_URL_MESSAGE = "Podaj poprawny link zaczynający się od http:// lub https://";

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
          src={p.url}
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
  onAdd: (url: string) => Promise<void>;
  onRemove: (photoId: string) => Promise<void>;
  onMove: (photoId: string, direction: "up" | "down") => Promise<void>;
  onClose: () => void;
}

/** Every action saves immediately; all controls are disabled while a photo
 * call and its follow-up refetch are pending, so a reorder never works from
 * a stale order. */
export function ItemGalleryEditor({ photos, busy, onAdd, onRemove, onMove, onClose }: ItemGalleryEditorProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const focusAfterMove = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  const moveButtons = useRef(new Map<string, HTMLButtonElement>());
  const inputRef = useRef<HTMLInputElement>(null);
  const atLimit = photos.length >= MAX_PRODUCT_PHOTOS;

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

  function handleAdd() {
    const trimmed = url.trim();
    if (!isValidImageUrl(trimmed)) {
      setError(INVALID_URL_MESSAGE);
      return;
    }
    void run(async () => {
      await onAdd(trimmed);
      setUrl("");
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
                <SafeImage src={p.url} alt="" className="h-12 w-12 flex-none rounded-xl" placeholderSize={20} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={p.url}>
                  {n}. {p.url}
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
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={inputRef}
          type="url"
          aria-label="Link do zdjęcia"
          placeholder="Wklej link do zdjęcia (https://…)"
          value={url}
          disabled={busy || atLimit}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
            if (e.key === "Escape") onClose();
          }}
          className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-cream px-2 py-1.5 text-[13.5px] text-ink disabled:opacity-60"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || atLimit}
          className="flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60"
        >
          + Dodaj
        </button>
      </div>
      {atLimit && <p className="mt-1.5 text-[12.5px] text-ink-soft">Osiągnięto limit {MAX_PRODUCT_PHOTOS} zdjęć.</p>}
      <p className="mt-1.5 text-[11.5px] text-ink-soft">
        Zdjęcia są wspólne dla wszystkich rzeczy tego produktu.
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
