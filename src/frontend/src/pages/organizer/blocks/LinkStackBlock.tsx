import { Link } from "react-router-dom";
import dayjs from "../../../utils/dayjs";
import type { BlockProps } from "../layouts/types";
import { nearestTerm } from "./nearestTerm";
import { ShareButton } from "./ShareButton";

const BUTTON =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const FILLED = "bg-primary text-on-primary";
const OUTLINED = "border border-line-strong bg-paper text-ink";
const SKELETON_BAR = "h-12 w-full rounded-2xl bg-line/60 animate-pulse motion-reduce:animate-none";

interface DirectoryLink {
  label: string;
  to: string;
}

function termPath(slug: string, term: { group_id: string; term_id: string }): string {
  return `/${slug}/grupa/${term.group_id}/term/${term.term_id}`;
}

/** LINKS button stack: the nearest term, the full agenda and the exchange,
 * then Share. It reads the directory itself, so it shows its own loading bars
 * and falls back to Share alone when the directory is unavailable. */
export function LinkStackBlock({ data }: BlockProps) {
  const { slug, name } = data.organization;
  const directory = data.directory;
  const links: DirectoryLink[] = [];

  if (directory) {
    const nearest = nearestTerm(directory);
    if (nearest) {
      links.push({
        label: `Najbliższe zajęcia · ${dayjs(nearest.occurs_on).format("dd D.MM HH:mm")}`,
        to: termPath(slug, nearest),
      });
    }
    const termCount = directory.stats.upcoming_term_count;
    if (termCount > 0) links.push({ label: `Wszystkie terminy (${termCount})`, to: `/${slug}/terminy` });
    const { counts, items } = directory.exchange;
    const itemCount = counts.GIFT + counts.SWAP + counts.LEND;
    const exchangeTerm = items[0] ?? nearest;
    if (itemCount > 0 && exchangeTerm) {
      links.push({ label: `Wymiana rzeczy (${itemCount})`, to: termPath(slug, exchangeTerm) });
    }
  }

  return (
    <div className="flex flex-col gap-3 px-6">
      {data.directoryStatus === "loading" && (
        <div aria-busy="true" className="flex flex-col gap-3">
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
