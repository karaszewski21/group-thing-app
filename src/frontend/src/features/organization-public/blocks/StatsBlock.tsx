import type { LucideIcon } from "lucide-react";
import type { OrganizerStats } from "../../../api/groups";
import { GroupsIcon, KragIcon, TermsIcon } from "../../../components/shared/Icons";
import { pluralPl } from "../../../utils/plural";
import type { BlockProps, OrganizerPageData } from "../layouts/types";

interface StatTile {
  key: string;
  Icon: LucideIcon;
  value: number;
  label: string;
}

/** Only stats worth showing: zero counts are skipped and `family_count` is
 * null (suppressed by the backend) below 3 families. */
function statTiles(stats: OrganizerStats): StatTile[] {
  const tiles: StatTile[] = [];
  if (stats.circle_count > 0) {
    tiles.push({
      key: "circles",
      Icon: GroupsIcon,
      value: stats.circle_count,
      label: pluralPl(stats.circle_count, "grupa", "grupy", "grup"),
    });
  }
  if (stats.upcoming_term_count > 0) {
    tiles.push({
      key: "terms",
      Icon: TermsIcon,
      value: stats.upcoming_term_count,
      label: `${pluralPl(stats.upcoming_term_count, "termin", "terminy", "terminów")} w 60 dni`,
    });
  }
  if (stats.family_count !== null) {
    tiles.push({
      key: "families",
      Icon: KragIcon,
      value: stats.family_count,
      label: pluralPl(stats.family_count, "rodzina", "rodziny", "rodzin"),
    });
  }
  return tiles;
}

/** A single stat is not worth a row of tiles. */
// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isStatsEmpty(data: OrganizerPageData): boolean {
  return !data.directory || statTiles(data.directory.stats).length < 2;
}

/** `tiles3`: up to three count tiles (circles, terms in the window, families). */
export function StatsBlock({ data }: BlockProps) {
  if (!data.directory) return null;
  const tiles = statTiles(data.directory.stats);

  return (
    <section aria-label="Statystyki" className="px-6 pt-6">
      <ul className="grid grid-cols-3 gap-2">
        {tiles.map(({ key, Icon, value, label }) => (
          <li key={key} className="flex flex-col gap-1 rounded-2xl border border-line bg-paper p-3">
            <div className="flex items-center justify-between gap-1">
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-soft" />
              <span className="text-lg font-extrabold leading-none text-ink">{value}</span>
            </div>
            <span className="text-[12px] leading-tight text-ink-soft">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
