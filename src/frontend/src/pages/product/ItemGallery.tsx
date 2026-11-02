import { useState } from "react";
import type { ModerationStatus, ProductPhotoResponse } from "../../api/products";
import { PhotoPlaceholder } from "../../components/shared/Icons";
import { PhotoViewer } from "../../components/shared/PhotoViewer";
import { isValidImageUrl } from "../../utils/url";
import { ModerationBadge } from "../../components/shared/PhotoGalleryField";

/** An image that swaps itself for the placeholder tile when it fails to load. */
export function SafeImage({
  src,
  alt,
  className,
  placeholderSize,
  fit = "cover",
}: {
  src: string;
  alt: string;
  className: string;
  placeholderSize: number;
  fit?: "cover" | "contain";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src || !isValidImageUrl(src)) {
    return (
      <span className={`flex items-center justify-center bg-cream ${className}`}>
        <PhotoPlaceholder size={placeholderSize} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={`${fit === "contain" ? "object-contain" : "object-cover"} ${className}`}
    />
  );
}

interface ItemGalleryProps {
  name: string;
  photos: ProductPhotoResponse[];
  productPhotoUrl: string | null;
  faded?: boolean;
  showOwnerHint?: boolean;
}

interface GallerySlide {
  url: string;
  status: ModerationStatus;
}

/** View-mode gallery, full-bleed at the top of the item page: the product's
 * photos (shared by every item of the product), else the catalog photo (no
 * badge), else a placeholder. Dots at the bottom switch photos; the bottom
 * 24px is left for the content sheet that overlaps it. Tapping the photo opens
 * the fullscreen viewer at it. Photos still in moderation (sent to owners only)
 * carry a status badge. */
export function ItemGallery({ name, photos, productPhotoUrl, faded, showOwnerHint }: ItemGalleryProps) {
  const slides: GallerySlide[] =
    photos.length > 0
      ? photos.map((p) => ({ url: p.url, status: p.status }))
      : productPhotoUrl
        ? [{ url: productPhotoUrl, status: "APPROVED" }]
        : [];
  const urls = slides.map((slide) => slide.url);
  const [active, setActive] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const current = Math.min(active, Math.max(urls.length - 1, 0));

  return (
    <div className={`relative bg-primary-soft ${faded ? "opacity-70" : ""}`}>
      {urls.length > 0 ? (
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          aria-label={`Powiększ zdjęcie ${current + 1} z ${urls.length}`}
          className="block w-full focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus-ring"
        >
          <SafeImage
            key={urls[current]}
            src={urls[current]}
            alt={`${name} — zdjęcie ${current + 1}`}
            className="aspect-4/3 w-full"
            placeholderSize={64}
          />
        </button>
      ) : (
        <span className="relative flex aspect-4/3 w-full flex-col items-center justify-center gap-3 overflow-hidden pb-6 text-primary-fg">
          {/* Stand-in in the organizer's palette: a dashed ring around the item icon. */}
          <svg aria-hidden="true" viewBox="0 0 390 292" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
            <circle cx="195" cy="132" r="96" fill="none" className="stroke-primary/25" strokeWidth="2" strokeDasharray="6 9" />
            <circle cx="105" cy="62" r="9" className="fill-accent" />
            <circle cx="292" cy="202" r="9" className="fill-primary/35" />
          </svg>
          <span className="relative flex h-29 w-29 items-center justify-center rounded-full bg-paper/70">
            <PhotoPlaceholder size={48} />
          </span>
          <span className="relative text-sm font-bold">
            {showOwnerHint ? "Dodaj zdjęcia w trybie edycji" : "Właściciel nie dodał jeszcze zdjęć"}
          </span>
        </span>
      )}
      {slides[current] && slides[current].status !== "APPROVED" && (
        <span className="absolute bottom-10 left-4">
          <ModerationBadge status={slides[current].status} />
        </span>
      )}
      {urls.length >= 2 && (
        <div className="absolute inset-x-0 bottom-8 flex justify-center gap-1">
          {urls.map((url, i) => (
            <button
              key={url}
              type="button"
              aria-pressed={i === current}
              aria-label={`Zdjęcie ${i + 1} z ${urls.length}`}
              onClick={() => setActive(i)}
              className="flex h-6 min-w-6 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <span
                aria-hidden="true"
                className={`block h-2 rounded-full shadow-sm transition-all ${i === current ? "w-6 bg-primary" : "w-2 bg-paper"}`}
              />
            </button>
          ))}
        </div>
      )}
      {viewerOpen && (
        <PhotoViewer
          name={name}
          urls={urls}
          startIndex={current}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}
