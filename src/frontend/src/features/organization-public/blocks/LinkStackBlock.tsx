import { Link } from "../../../routing/navigation";
import { pluralPl } from "../../../utils/plural";
import type { BlockProps } from "../layouts/types";
import { ShareButton } from "./ShareButton";

// The stack sits on the primary-colored LINKS page: the first action is a
// white card, the rest are see-through pills in the on-primary color.
const BUTTON =
  "flex w-full items-center justify-center gap-2 px-5 text-[15px] font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-primary";
const FILLED = "min-h-16 rounded-[22px] bg-paper text-ink shadow-md";
const OUTLINED = "min-h-14 rounded-full border-[1.5px] border-on-primary/30 bg-on-primary/10 text-on-primary";
const SKELETON_BAR = "h-14 w-full rounded-full bg-on-primary/20 animate-pulse motion-reduce:animate-none";

interface StackLink {
  label: string;
  hint: string;
  to: string;
}

/** LINKS button stack built from the owner's stats: meetings and items,
 * each with its count and only when it has something, then Share.
 * It reads the stats itself, so it shows its own loading bars and falls back
 * to Share alone when they are unavailable. */
export function LinkStackBlock({ data }: BlockProps) {
  const { slug, name } = data.organization;
  const stats = data.directory?.stats;
  const links: StackLink[] = [];

  if (stats) {
    if (stats.meeting_count > 0) {
      links.push({
        label: "Spotkania",
        hint: `${stats.meeting_count} ${pluralPl(stats.meeting_count, "nadchodzące", "nadchodzące", "nadchodzących")}`,
        to: `/${slug}/meetings`,
      });
    }
    if (stats.item_count > 0) {
      links.push({
        label: "Rzeczy",
        hint: `${stats.item_count} ${pluralPl(stats.item_count, "dostępna", "dostępne", "dostępnych")}`,
        to: `/${slug}/items`,
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
        <Link key={link.to} to={link.to} className={`${BUTTON} ${index === 0 ? FILLED : OUTLINED}`}>
          {link.label}
          <span className="text-[13px] font-bold opacity-75">· {link.hint}</span>
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
