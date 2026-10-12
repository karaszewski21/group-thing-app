import { SafeImage } from "../../product/ItemGallery";
import type { BlockProps, OrganizerPageData } from "../layouts/types";

const COLUMNS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2" };

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isGalleryEmpty(data: OrganizerPageData): boolean {
  return (data.organization.gallery ?? []).length === 0;
}

/** The organization's approved photos as non-interactive tiles: up to three
 * square thumbnails in a row, or one full-width 4:3 photo. `on-primary` is for
 * the primary-colored LINKS page. */
export function GalleryBlock({ data, variant }: BlockProps) {
  const { name, gallery = [] } = data.organization;
  const single = gallery.length === 1;
  const heading = variant === "on-primary" ? "text-center text-on-primary" : "text-ink";

  return (
    <section aria-label="Galeria" className="px-6 pt-6">
      <h2 className={`mb-3 font-serif text-xl font-bold ${heading}`}>Galeria</h2>
      <ul className={`grid gap-2 ${COLUMNS[gallery.length] ?? "grid-cols-3"}`}>
        {gallery.map((photo, index) => (
          <li key={photo.url}>
            <SafeImage
              src={single ? photo.url : photo.thumb_url}
              alt={`${name} — zdjęcie ${index + 1} z ${gallery.length}`}
              className={`w-full rounded-2xl ${single ? "aspect-[4/3]" : "aspect-square"}`}
              placeholderSize={single ? 48 : 28}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
