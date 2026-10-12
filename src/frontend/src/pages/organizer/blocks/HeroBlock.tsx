import { useState } from "react";
import type { PublicMedia } from "../../../api/organizations";
import { familyInitials } from "../../../components/shared/Avatar";
import { isValidImageUrl } from "../../../utils/url";
import type { BlockProps } from "../layouts/types";
import { ShareButton } from "./ShareButton";

// Over a photo the name sits in the bottom third, which this fade keeps at the
// strong scrim (4.5:1 for on-ink text on any image); the top stays clear.
const COVER_SCRIM =
  "absolute inset-0 bg-gradient-to-b from-transparent from-10% via-scrim via-40% to-scrim-strong to-70%";
// LINKS: the same strong scrim under the name, then a fade into the page color.
const CENTERED_SCRIM =
  "absolute inset-0 bg-gradient-to-b from-scrim from-0% via-scrim-strong via-75% to-primary to-100%";

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
 * primary color band, or the cover photo fading into a strong scrim when there
 * is one; `centered` is the LINKS hero on the primary page, its cover photo
 * fading into that color; `compact` is a top bar that carries the share action itself, under a
 * strip of the cover photo that the logo overlaps when there is one. */
export function HeroBlock({ data, variant, heroAction }: BlockProps) {
  const { name, slug, logo, cover } = data.organization;
  const initials = familyInitials(name);
  const coverImage = useImage(cover?.url);
  const overCover = cover != null && coverImage.shown;
  const floatingAction = heroAction ? <div className="absolute top-3 right-4 z-10">{heroAction}</div> : null;

  if (variant === "compact") {
    return (
      <div className="relative">
        {overCover && floatingAction}
        {overCover && (
          <img
            src={cover.url}
            alt=""
            referrerPolicy="no-referrer"
            onError={coverImage.onError}
            className="block h-30 w-full object-cover"
          />
        )}
        <header className="flex items-center gap-3 border-b border-line bg-paper px-6 py-4">
          <HeroLogo
            logo={logo}
            initials={initials}
            className={
              overCover
                ? "relative -mt-12 h-18 w-18 shrink-0 self-start border-4 border-paper shadow-md"
                : "h-14 w-14 shrink-0"
            }
            initialsClassName="bg-primary font-serif text-lg font-semibold text-on-primary"
          />
          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 font-serif text-xl leading-tight font-bold wrap-break-word text-ink">{name}</h1>
            <p className="truncate text-[12.5px] text-ink-soft">domena.pl/{slug}</p>
          </div>
          {!overCover && heroAction}
          <ShareButton
            slug={slug}
            name={name}
            label="Udostępnij"
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-4 text-sm font-extrabold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          />
        </header>
      </div>
    );
  }

  if (variant === "centered") {
    // The LINKS page is the primary color; the cover fades into it below the name.
    const textColor = overCover ? "text-on-ink" : "text-on-primary";
    return (
      <header className="relative overflow-hidden">
        {floatingAction}
        {overCover && (
          <>
            <img
              src={cover.url}
              alt=""
              referrerPolicy="no-referrer"
              onError={coverImage.onError}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span aria-hidden="true" className={CENTERED_SCRIM} />
          </>
        )}
        <div
          className={`relative flex flex-col items-center px-6 text-center ${overCover ? "min-h-80 justify-end pt-16 pb-20" : "pt-12 pb-8"}`}
        >
          <HeroLogo
            logo={logo}
            initials={initials}
            className={`mb-4 h-24 w-24 border-4 ${overCover ? "border-on-ink" : "border-on-primary"}`}
            initialsClassName="bg-paper font-serif text-3xl font-bold text-primary-fg"
          />
          <h1 className={`font-serif text-3xl font-bold tracking-tight ${textColor}`}>{name}</h1>
          <p className={`mt-1 text-sm ${textColor}`}>domena.pl/{slug}</p>
        </div>
      </header>
    );
  }

  // Over a photo the palette's on-primary may be dark, so the text and the
  // logo ring switch to the fixed light token over the strong scrim.
  const textColor = overCover ? "text-on-ink" : "text-on-primary";
  const ringColor = overCover ? "border-on-ink" : "border-on-primary";

  return (
    <header
      className={`relative flex flex-col justify-end overflow-hidden rounded-b-[34px] bg-primary ${overCover ? "min-h-75" : ""}`}
    >
      {floatingAction}
      {overCover && (
        <>
          <img
            src={cover.url}
            alt=""
            referrerPolicy="no-referrer"
            onError={coverImage.onError}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span aria-hidden="true" className={COVER_SCRIM} />
        </>
      )}
      <div className="relative flex flex-col gap-4 px-6 pt-10 pb-8">
        <HeroLogo
          logo={logo}
          initials={initials}
          className={`h-20 w-20 border-4 ${ringColor}`}
          initialsClassName="bg-primary font-serif text-2xl font-bold text-on-primary"
        />
        <div>
          <h1 className={`font-serif text-4xl leading-tight font-bold tracking-tight ${textColor}`}>{name}</h1>
          <p className={`mt-1 text-sm ${textColor}`}>domena.pl/{slug}</p>
        </div>
      </div>
    </header>
  );
}
