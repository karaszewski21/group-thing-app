import { useState } from "react";
import type { ProductPhotoResponse } from "../../api/products";
import { PhotoGalleryField } from "../../components/shared/PhotoGalleryField";
import { MAX_PRODUCT_PHOTOS, photoFileError } from "./itemPageShared";

interface ItemGalleryEditorProps {
  photos: ProductPhotoResponse[];
  busy: boolean;
  onAdd: (file: File) => Promise<void>;
  onRemove: (photoId: string) => Promise<void>;
  onMove: (photoId: string, direction: "up" | "down") => Promise<void>;
}

/** Edit-mode replacement for `ItemGallery` at the top of the item page: the
 * product's saved photos in the shared slider. Every action saves
 * immediately; all controls are disabled while a photo call and its
 * follow-up refetch are pending, so a reorder never works from a stale
 * order. */
export function ItemGalleryEditor({ photos, busy, onAdd, onRemove, onMove }: ItemGalleryEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const activeCount = photos.filter((p) => p.status !== "REJECTED").length;

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

  return (
    <div className="relative">
      <PhotoGalleryField
        photos={photos.map((p) => ({ id: p.id, src: p.url, status: p.status }))}
        max={MAX_PRODUCT_PHOTOS}
        disabled={busy}
        onFiles={handleFiles}
        onRemove={(id) => void run(() => onRemove(id))}
        onMove={(id, dir) => void run(() => onMove(id, dir))}
        fullBleed
      />
      {error && (
        <p
          role="alert"
          className="absolute inset-x-4 top-16 rounded-xl bg-danger-soft px-3 py-2.5 text-[12.5px] font-semibold text-danger shadow-md"
        >
          {error}
        </p>
      )}
    </div>
  );
}
