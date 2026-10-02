import { useState } from "react";
import type { ModerationStatus, ProductPhotoResponse } from "../../api/products";
import { PhotoPlaceholder } from "../../components/shared/Icons";
import { isValidImageUrl } from "../../utils/url";
import { ModerationBadge } from "./ItemGalleryEditor";

/** An image that swaps itself for the placeholder tile when it fails to load. */
export function SafeImage({
  src,
  alt,
  className,
  placeholderSize,
}: {
  src: string;
  alt: string;
  className: string;
  placeholderSize: number;
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
      className={`object-cover ${className}`}
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
  thumbUrl: string;
  status: ModerationStatus;
}

/** View-mode gallery: the product's photos (shared by every item of the
 * product), else the catalog photo (no badge), else a placeholder. The
 * thumbnail strip scrolls on its own so the page never does. Photos still
 * in moderation (sent to owners only) carry a status badge. */
export function ItemGallery({ name, photos, productPhotoUrl, faded, showOwnerHint }: ItemGalleryProps) {
  const slides: GallerySlide[] =
    photos.length > 0
      ? photos.map((p) => ({ url: p.url, thumbUrl: p.thumb_url, status: p.status }))
      : productPhotoUrl
        ? [{ url: productPhotoUrl, thumbUrl: productPhotoUrl, status: "APPROVED" }]
        : [];
  const urls = slides.map((slide) => slide.url);
  const [active, setActive] = useState(0);
  const current = Math.min(active, Math.max(urls.length - 1, 0));

  return (
    <div className={`rounded-[22px] border border-line bg-paper p-2 ${faded ? "opacity-70" : ""}`}>
      <div className="relative">
        {urls.length > 0 ? (
          <SafeImage
            key={urls[current]}
            src={urls[current]}
            alt={`${name} — zdjęcie ${current + 1}`}
            className="aspect-[4/3] w-full rounded-2xl"
            placeholderSize={64}
          />
        ) : (
          <span className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-cream">
            <PhotoPlaceholder size={64} />
          </span>
        )}
        {slides[current] && slides[current].status !== "APPROVED" && (
          <span className="absolute left-2 top-2">
            <ModerationBadge status={slides[current].status} />
          </span>
        )}
        {urls.length >= 2 && (
          <span className="absolute bottom-2 right-2 rounded-full bg-ink/70 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white">
            {current + 1} / {urls.length}
          </span>
        )}
      </div>
      {urls.length >= 2 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {urls.map((url, i) => (
            <button
              key={url}
              type="button"
              aria-pressed={i === current}
              aria-label={`Zdjęcie ${i + 1} z ${urls.length}`}
              onClick={() => setActive(i)}
              className={`h-14 w-14 flex-none overflow-hidden rounded-xl ${
                i === current ? "ring-2 ring-mint" : "border border-line"
              }`}
            >
              <SafeImage src={slides[i].thumbUrl} alt="" className="h-full w-full" placeholderSize={20} />
            </button>
          ))}
        </div>
      )}
      {urls.length === 0 && showOwnerHint && (
        <p className="px-1 pt-2 text-[12.5px] text-ink-soft">Dodaj zdjęcia w trybie edycji</p>
      )}
    </div>
  );
}
