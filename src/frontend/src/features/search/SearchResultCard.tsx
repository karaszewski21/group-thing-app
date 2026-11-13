import type { ReactNode } from "react";
import type { ProductSearchResult, SearchResult } from "../../api/search";
import { ItemCard } from "../../components/shared/ItemCard";
import { BuildingIcon, FamilyIcon } from "../../components/shared/appIcons";
import { Link } from "../../routing/navigation";
import dayjs from "../../utils/dayjs";
import { DateTile } from "../organization-public/blocks/DateTile";

const ROW_CLASS =
  "flex min-h-11 gap-3 rounded-2xl border border-line bg-paper p-3 text-left outline-none hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const ICON_CLASS = "flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px]";

/** „Zarezerwowana do pt 21 lis” for a term's or event's reservation,
 * „Zarezerwowana” for a personal pickup or a pending proposal. */
function reservedCaption({ reserved, reserved_until }: ProductSearchResult["meta"]): string | undefined {
  if (!reserved) return undefined;
  return reserved_until ? `Zarezerwowana do ${dayjs(reserved_until).format("ddd D MMM")}` : "Zarezerwowana";
}

function joinParts(parts: (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

/** One search result: an item tile for a product, otherwise a row that opens `href`. */
export function SearchResultCard({ result }: { result: SearchResult }) {
  switch (result.kind) {
    case "product":
      return (
        <ItemCard
          href={result.href}
          name={result.title}
          condition={result.meta.condition}
          thumbUrl={result.meta.thumb_url}
          mode={result.meta.mode}
          reservation={null}
          reservedCaption={reservedCaption(result.meta)}
        />
      );
    case "term":
    case "event":
      return (
        <ResultRow
          href={result.href}
          aside={<DateTile occursOn={result.meta.starts_at} />}
          label={result.kind === "term" ? "Termin" : "Wydarzenie"}
          mine={result.kind === "term" && result.meta.in_my_groups}
          title={result.title}
        >
          <span className="block text-[12.5px] text-ink-soft">
            {joinParts([result.subtitle, dayjs(result.meta.starts_at).format("HH:mm"), result.meta.place])}
          </span>
        </ResultRow>
      );
    case "group":
      return (
        <ResultRow
          href={result.href}
          aside={
            <span aria-hidden="true" className={`${ICON_CLASS} bg-accent-soft`}>
              <FamilyIcon />
            </span>
          }
          label="Grupa"
          mine={result.meta.in_my_groups}
          title={result.title}
        >
          {result.subtitle && <span className="block text-[12.5px] text-ink-soft">{result.subtitle}</span>}
          {result.meta.description && (
            <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-ink">{result.meta.description}</span>
          )}
          {result.meta.next_starts_at && (
            <span className="mt-1 block text-[12.5px] font-bold text-primary-fg">
              najbliższe spotkanie: {dayjs(result.meta.next_starts_at).format("ddd D MMM, HH:mm")}{" "}
              <span aria-hidden="true">→</span>
            </span>
          )}
        </ResultRow>
      );
    case "organization":
      return (
        <ResultRow
          href={result.href}
          aside={
            <span aria-hidden="true" className={`${ICON_CLASS} bg-cream`}>
              <BuildingIcon />
            </span>
          }
          label="Organizacja"
          mine={false}
          title={result.title}
        >
          <span className="block text-[12.5px] text-ink-soft">/{result.meta.slug}</span>
        </ResultRow>
      );
  }
}

function ResultRow({
  href,
  aside,
  label,
  mine,
  title,
  children,
}: {
  href: string;
  aside: ReactNode;
  label: string;
  mine: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <Link to={href} className={ROW_CLASS}>
      {aside}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-ink-soft">
          {label}
          {mine && " "}
          {mine && (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10.5px] normal-case tracking-normal text-primary-fg">
              moja grupa
            </span>
          )}
        </span>{" "}
        <span className="block text-[15px] font-extrabold text-ink">{title}</span> {children}
      </span>
    </Link>
  );
}
