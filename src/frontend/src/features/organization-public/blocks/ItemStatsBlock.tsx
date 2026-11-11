import { Link } from "../../../routing/navigation";
import type { ExchangeMode } from "../../../api/groups";
import { EXCHANGE_MODE_TONE, INTENT_LABELS } from "../../terms/components/termLabels";
import { itemStatsOf } from "../layouts/layoutData";
import type { BlockProps, OrganizerPageData } from "../layouts/types";

const MODES: ExchangeMode[] = ["GIFT", "SWAP"];
const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isItemStatsEmpty(data: OrganizerPageData): boolean {
  const stats = itemStatsOf(data.directory);
  return !stats || stats.GIFT + stats.SWAP === 0;
}

/** "N Chcę oddać · N Chcę się zamienić": the owner's available items per
 * mode, both leading to the owner's items page. */
export function ItemStatsBlock({ data }: BlockProps) {
  const stats = itemStatsOf(data.directory);
  if (!stats) return null;
  const itemsPath = `/${data.organization.slug}/items`;

  return (
    <section className="px-6 pt-6">
      <h2 className="mb-3 font-serif text-xl font-semibold text-ink">Wymiana rzeczy</h2>
      <ul className="grid grid-cols-2 gap-2">
        {MODES.map((mode) => (
          <li key={mode}>
            <Link
              to={itemsPath}
              className={`flex min-h-[72px] flex-col items-center justify-center rounded-2xl px-2 py-3 text-center ${EXCHANGE_MODE_TONE[mode]} ${FOCUS_RING}`}
            >
              <span className="text-xl font-extrabold">{stats[mode]}</span>{" "}
              <span className="text-[12px] font-bold">{INTENT_LABELS[mode]}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        to={itemsPath}
        className={`mt-1 flex min-h-[44px] items-center justify-center text-[13px] font-bold text-primary-fg ${FOCUS_RING}`}
      >
        Wszystkie rzeczy →
      </Link>
    </section>
  );
}
