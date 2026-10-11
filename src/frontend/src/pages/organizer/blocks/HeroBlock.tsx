import { useState } from "react";
import type { PublicMedia } from "../../../api/organizations";
import { familyInitials } from "../../../components/shared/Avatar";
import { isValidImageUrl } from "../../../utils/url";
import type { BlockProps } from "../layouts/types";
import { ShareButton } from "./ShareButton";

/** Whether an image URL can be shown: valid and not failed to load. */
function useImage(src: string | undefined) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = src !== undefined && src !== failedSrc && isValidImageUrl(src);
  return { shown, onError: () => setFailedSrc(src ?? null) };
}

/** The logo thumbnail, or the initials when there is none or it fails.
 * `className` carries the size and placement shared by both. */
function HeroLogo({
  logo,
  initials,
  className,
  initialsClassName,
}: {
  logo: PublicMedia | null;
  initials: string;
  className: string;
  initialsClassName: string;
}) {
  const image = useImage(logo?.thumb_url);
  if (logo && image.shown) {
    return (
      <img
        src={logo.thumb_url}
        alt=""
        referrerPolicy="no-referrer"
        onError={image.onError}
        className={`${className} rounded-full bg-paper object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} flex items-center justify-center rounded-full ${initialsClassName}`}
    >
      {initials}
    </span>
  );
}

/** Organization name, logo (or initials) and public address. `cover` is a
 * primary color band, with the cover photo under a strong scrim when there
 * is one; `centered` is the LINKS hero, a card over the cover photo when
 * there is one; `compact` is a top bar that carries the share action itself,
 * under a thin strip of the cover photo when there is one. */
export function HeroBlock({ data, variant }: BlockProps) {
  const { name, slug, logo, cover } = data.organization;
  const initials = familyInitials(name);
  const coverImage = useImage(cover?.url);
  const overCover = cover != null && coverImage.shown;

  if (variant === "compact") {
    return (
      <>
        {overCover && (
          <img
            src={cover.url}
            alt=""
            referrerPolicy="no-referrer"
            onError={coverImage.onError}
            className="block h-24 w-full object-cover"
          />
        )}
        <header className="flex items-center gap-3 border-b border-line bg-paper px-6 py-4">
          <HeroLogo
            logo={logo}
            initials={initials}
            className="h-14 w-14 shrink-0"
            initialsClassName="bg-primary font-serif text-lg font-semibold text-on-primary"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-xl font-semibold text-ink">{name}</h1>
            <p className="truncate text-[12.5px] text-ink-soft">domena.pl/{slug}</p>
          </div>
          <ShareButton
            slug={slug}
            name={name}
            label="Udostępnij"
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-4 text-sm font-extrabold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          />
        </header>
      </>
    );
  }

  if (variant === "centered") {
    return (
      <header className={overCover ? "relative mx-4 mb-4 overflow-hidden rounded-3xl" : ""}>
        {overCover && (
          <img
            src={cover.url}
            alt=""
            referrerPolicy="no-referrer"
            onError={coverImage.onError}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div
          className={`relative flex flex-col items-center px-6 pt-10 pb-6 text-center ${overCover ? "bg-scrim-strong" : ""}`}
        >
          <HeroLogo
            logo={logo}
            initials={initials}
            className={`mb-4 h-20 w-20 ${overCover ? "border-2 border-on-ink" : ""}`}
            initialsClassName="bg-primary font-serif text-2xl font-semibold text-on-primary"
          />
          <h1 className={`font-serif text-3xl font-semibold ${overCover ? "text-on-ink" : "text-ink"}`}>{name}</h1>
          <p className={`mt-1 text-sm ${overCover ? "text-on-ink" : "text-ink-soft"}`}>domena.pl/{slug}</p>
        </div>
      </header>
    );
  }

  // Over a photo the palette's on-primary may be dark, so the text and the
  // logo ring switch to the fixed light token on a solid strong scrim.
  const textColor = overCover ? "text-on-ink" : "text-on-primary";
  const ringColor = overCover ? "border-on-ink" : "border-on-primary";

  return (
    <header className="relative overflow-hidden bg-primary">
      {overCover && (
        <img
          src={cover.url}
          alt=""
          referrerPolicy="no-referrer"
          onError={coverImage.onError}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div
        className={`relative px-6 pt-10 pb-4 ${overCover ? "bg-gradient-to-t from-scrim-strong to-transparent" : ""}`}
      >
        <HeroLogo
          logo={logo}
          initials={initials}
          className={`h-16 w-16 border-2 ${ringColor}`}
          initialsClassName="bg-primary font-serif text-xl font-semibold text-on-primary"
        />
      </div>
      <div className={`relative px-6 pb-8 ${overCover ? "bg-scrim-strong" : ""}`}>
        <h1 className={`font-serif text-3xl font-semibold ${textColor}`}>{name}</h1>
        <p className={`mt-1 text-sm ${textColor}`}>domena.pl/{slug}</p>
      </div>
    </header>
  );
}
