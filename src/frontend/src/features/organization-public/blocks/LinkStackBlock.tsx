import { Link } from "../../../routing/navigation";
import dayjs from "../../../utils/dayjs";
import type { BlockProps } from "../layouts/types";
import { exchangeTotal, organizerTermPath } from "../organizerHelpers";
import { ShareButton } from "./ShareButton";

// The stack sits on the primary-colored LINKS page: the first action is a
// white card, the rest are see-through pills in the on-primary color.
const BUTTON =
  "flex w-full items-center justify-center gap-2 px-5 text-[15px] font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-primary";
const FILLED = "min-h-16 rounded-[22px] bg-paper text-ink shadow-md";
const OUTLINED = "min-h-14 rounded-full border-[1.5px] border-on-primary/30 bg-on-primary/10 text-on-primary";
const SKELETON_BAR = "h-14 w-full rounded-full bg-on-primary/20 animate-pulse motion-reduce:animate-none";

interface DirectoryLink {
  label: string;
  to: string;
}

/** LINKS button stack: the nearest term or event, all meetings, the owner's
 * items (else the exchange of the next term), then Share. It reads the
 * directory itself, so it shows its own loading bars and falls back to Share
 * alone when the directory is unavailable. */
export function LinkStackBlock({ data }: BlockProps) {
  const { slug, name } = data.organization;
  const directory = data.directory;
  const links: DirectoryLink[] = [];

  if (directory) {
    const [nearest] = directory.upcoming_dates;
    if (nearest) {
      links.push({
        label: `${nearest.kind === "EVENT" ? "Najbliższe wydarzenie" : "Najbliższe zajęcia"} · ${dayjs(nearest.starts_at).format("dd D.MM HH:mm")}`,
        to: nearest.path,
      });
      links.push({ label: "Wszystkie spotkania", to: `/${slug}/meetings` });
    }
    const { counts, items } = directory.exchange;
    const itemCount = exchangeTotal(counts);
    if (directory.recent_items.length > 0) {
      links.push({ label: "Rzeczy do oddania i wymiany", to: `/${slug}/items` });
    } else if (itemCount > 0 && items[0]) {
      links.push({
        label: `Wymiana rzeczy (${itemCount})`,
        to: organizerTermPath(slug, items[0].group_id, items[0].term_id),
      });
    }
  }

  return (
    <div className="flex flex-col gap-3 px-6">
      {data.directoryStatus === "loading" && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Ładowanie…</span>
          <div aria-hidden="true" className={SKELETON_BAR} />
          <div aria-hidden="true" className={SKELETON_BAR} />
        </div>
      )}
      {links.map((link, index) => (
        <Link key={link.to + link.label} to={link.to} className={`${BUTTON} ${index === 0 ? FILLED : OUTLINED}`}>
          {link.label}
        </Link>
      ))}
      <ShareButton
        slug={slug}
        name={name}
        label="Udostępnij stronę"
        className={`${BUTTON} ${links.length === 0 ? FILLED : OUTLINED}`}
      />
    </div>
  );
}
