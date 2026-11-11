import type { LucideIcon } from "lucide-react";
import type { OrganizationStats } from "../../../api/organizations";
import { GroupsIcon, ProductsIcon, TermsIcon } from "../../../components/shared/Icons";
import { Link } from "../../../routing/navigation";
import { pluralPl } from "../../../utils/plural";
import type { BlockProps, OrganizerPageData } from "../layouts/types";

interface StatTile {
  key: string;
  Icon: LucideIcon;
  value: number;
  label: string;
  to: string;
}

/** The non-zero counts, each leading to the page that lists them. */
function statTiles(stats: OrganizationStats, slug: string): StatTile[] {
  const tiles: StatTile[] = [
    {
      key: "groups",
      Icon: GroupsIcon,
      value: stats.group_count,
      label: pluralPl(stats.group_count, "grupa", "grupy", "grup"),
      to: `/${slug}/meetings`,
    },
    {
      key: "meetings",
      Icon: TermsIcon,
      value: stats.meeting_count,
      label: pluralPl(stats.meeting_count, "spotkanie", "spotkania", "spotkań"),
      to: `/${slug}/meetings`,
    },
    {
      key: "items",
      Icon: ProductsIcon,
      value: stats.item_count,
      label: pluralPl(stats.item_count, "rzecz", "rzeczy", "rzeczy"),
      to: `/${slug}/items`,
    },
  ];
  return tiles.filter((tile) => tile.value > 0);
}

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isStatsEmpty(data: OrganizerPageData): boolean {
  return !data.directory || statTiles(data.directory.stats, data.organization.slug).length === 0;
}

/** Up to three count tiles (groups, upcoming meetings, available items),
 * each a link to the full list. */
export function StatsBlock({ data }: BlockProps) {
  if (!data.directory) return null;
  const tiles = statTiles(data.directory.stats, data.organization.slug);
  const columns = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3"][tiles.length];

  return (
    <section aria-label="Statystyki" className="px-6 pt-6">
      <ul className={`grid gap-2 ${columns}`}>
        {tiles.map(({ key, Icon, value, label, to }) => (
          <li key={key}>
            <Link
              to={to}
              className="flex min-h-[72px] flex-col gap-1 rounded-2xl border border-line bg-paper p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <span className="flex items-center justify-between gap-1">
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-soft" />
                <span className="text-lg font-extrabold leading-none text-ink">{value}</span>
              </span>{" "}
              <span className="text-[12px] leading-tight text-ink-soft">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
