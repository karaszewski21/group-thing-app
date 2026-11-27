import type { ReactNode } from "react";
import type { ProductSearchResult, SearchResult } from "../../api/search";
import { BuildingIcon, FamilyIcon } from "../../components/shared/appIcons";
import { ItemCard } from "../../components/shared/ItemCard";
import { Link } from "../../routing/navigation";
import dayjs from "../../utils/dayjs";
import { MeetingResultTile, RESULT_ROW_CLASS } from "./MeetingResultTile";
import { ResultKindLabel } from "./ResultKindLabel";

const ICON_CLASS = "flex h-14 w-14 flex-none items-center justify-center rounded-2xl md:h-16 md:w-16";

/** „Zarezerwowana do pt 21 lis” for a term's or event's reservation,
 * „Zarezerwowana” for a personal pickup or a pending proposal. */
function reservedCaption({ reserved, reserved_until }: ProductSearchResult["meta"]): string | undefined {
  if (!reserved) return undefined;
  return reserved_until ? `Zarezerwowana do ${dayjs(reserved_until).format("ddd D MMM")}` : "Zarezerwowana";
}

/** One search result: the app's item tile for a product, a meeting tile for
 * a term or an event, and a directory row for a group or an organization. */
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
          pointsPrice={result.meta.points_price}
          reservation={null}
          reservedCaption={reservedCaption(result.meta)}
        />
      );
    case "term":
    case "event":
      return <MeetingResultTile result={result} />;
    case "group":
      return (
        <DirectoryRow
          href={result.href}
          icon={
            <span aria-hidden="true" className={`${ICON_CLASS} bg-accent-soft text-accent-fg`}>
              <FamilyIcon c="currentColor" />
            </span>
          }
          label={<ResultKindLabel label="Grupa" mine={result.meta.in_my_groups} />}
          title={result.title}
        >
          {result.subtitle && <span className="block text-[13px] text-ink-soft md:text-sm">{result.subtitle}</span>}
          {result.meta.description && (
            <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink md:text-sm">{result.meta.description}</span>
          )}
          {result.meta.next_starts_at && (
            <span className="mt-1 block text-[13px] font-extrabold text-primary-fg md:text-sm">
              najbliższe spotkanie: {dayjs(result.meta.next_starts_at).format("ddd D MMM, HH:mm")}{" "}
              <span aria-hidden="true">→</span>
            </span>
          )}
        </DirectoryRow>
      );
    case "organization":
      return (
        <DirectoryRow
          href={result.href}
          icon={
            <span aria-hidden="true" className={`${ICON_CLASS} bg-primary-soft text-primary-fg`}>
              <BuildingIcon c="currentColor" />
            </span>
          }
          label={<ResultKindLabel label="Organizacja" />}
          title={result.title}
        >
          <span className="block text-[13px] text-ink-soft md:text-sm">/{result.meta.slug}</span>
        </DirectoryRow>
      );
  }
}

function DirectoryRow({
  href,
  icon,
  label,
  title,
  children,
}: {
  href: string;
  icon: ReactNode;
  label: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Link to={href} className={RESULT_ROW_CLASS}>
      {icon}
      <span className="min-w-0 flex-1">
        {label}{" "}
        <span className="mt-0.5 block text-[16px] leading-snug font-extrabold text-ink md:text-[17px]">{title}</span>{" "}
        {children}
      </span>
    </Link>
  );
}
