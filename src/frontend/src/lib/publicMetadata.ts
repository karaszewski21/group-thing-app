/* Link-preview metadata (Open Graph / Twitter Card) for the shareable public
 * pages. Bots that unfurl links read only the first HTML response, so these
 * are rendered on the server by each page's `generateMetadata`. A missing
 * DTO yields `{}`, which leaves the root layout's default title and no OG tags. */
import type { Metadata } from "next";
import type { EventDetailResponse } from "../api/events";
import type { PublicCircleResponse } from "../api/groups";
import type { ItemDetailsResponse } from "../api/items";
import type { PublicOrganizationResponse } from "../api/organizations";
import { isPartyId } from "../routing/paths";
import { RESERVED_SLUGS } from "../routing/reservedSlugs";
import { CONDITION_LABELS } from "../utils/productCategory";

const WEEKDAYS = ["pon", "wt", "śr", "czw", "pt", "sob", "ndz"];

/** A first path segment that can name an Organization: not a person's
 * profile, not the `krag` placeholder, not a route or a file name. */
export function isOrganizationSlug(slug: string): boolean {
  return !isPartyId(slug) && slug !== "krag" && !RESERVED_SLUGS.includes(slug) && !slug.includes(".");
}

function previewMetadata(title: string, description: string, imageUrl: string | null): Metadata {
  const images = imageUrl === null ? {} : { images: [imageUrl] };
  return {
    title,
    openGraph: { title, description, type: "website", ...images },
    twitter: { card: imageUrl === null ? "summary" : "summary_large_image", title, description, ...images },
  };
}

/** `{weekday} DD.MM o HH:mm` read straight off a naive Warsaw
 * `YYYY-MM-DDTHH:mm…` string, with no time-zone conversion. */
function formatWhen(startsAt: string): string {
  const [year, month, day] = startsAt.slice(0, 10).split("-");
  const weekday = (new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay() + 6) % 7;
  return `${WEEKDAYS[weekday]} ${day}.${month} o ${startsAt.slice(11, 16)}`;
}

export function organizationMetadata(organization: PublicOrganizationResponse | null): Metadata {
  if (organization === null) return {};
  return previewMetadata(
    organization.name,
    `Strona organizacji ${organization.name}.`,
    organization.cover?.url ?? null,
  );
}

export function eventMetadata(event: EventDetailResponse | null): Metadata {
  if (event === null) return {};
  let description = formatWhen(event.starts_at);
  if (event.location) description += ` · ${event.location.label}`;
  if (event.description) description += ` ${event.description}`;
  return previewMetadata(event.name, description, event.banner_url);
}

export function termMetadata(circle: PublicCircleResponse | null): Metadata {
  if (circle === null) return {};
  let description = "Dołącz i zobacz najbliższe spotkania.";
  if (circle.term !== null) {
    const [year, month, day] = circle.term.occurs_on.slice(0, 10).split("-");
    description = `Najbliższy termin: ${day}.${month}.${year}.`;
    if (circle.term.description) description += ` ${circle.term.description}`;
  }
  return previewMetadata(circle.name, description, null);
}

/** A deleted item gets no preview; the image is its first photo, else the catalog photo. */
export function itemMetadata(item: ItemDetailsResponse | null): Metadata {
  if (item === null || item.deleted_at !== null) return {};
  let description = `Stan: ${CONDITION_LABELS[item.condition]}.`;
  if (item.category_name) description = `${item.category_name} · ${description}`;
  if (item.description) description += ` ${item.description}`;
  return previewMetadata(item.name, description, item.photos[0]?.url ?? item.product_photo_url);
}
