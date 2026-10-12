import { Link } from "react-router-dom";
import type { GroupLayoutMode, OrganizerCircle } from "../../../api/groups";
import { GroupsIcon } from "../../../components/shared/Icons";
import dayjs from "../../../utils/dayjs";
import { pluralPl } from "../../../utils/plural";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { organizerTermPath } from "../organizerHelpers";
import { CircleVisualMini } from "./CircleVisualMini";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isCirclesGridEmpty(data: OrganizerPageData): boolean {
  return (data.directory?.circles.length ?? 0) === 0;
}

const LAYOUT_LABEL: Record<GroupLayoutMode, string> = { CIRCLE: "Krąg", PITCH: "Boisko", TABLE: "Stół" };

/** The circle's next term page, else the terms list filtered to the circle. */
function circleHref(slug: string, circle: OrganizerCircle): string {
  return circle.next_term
    ? organizerTermPath(slug, circle.id, circle.next_term.id)
    : `/${slug}/terminy?group_id=${circle.id}`;
}

function CircleFacts({ circle }: { circle: OrganizerCircle }) {
  const next = circle.next_term;
  if (!next) return <span className="mt-1 block text-[13px] text-ink-soft">brak zaplanowanych terminów</span>;
  const terms = circle.upcoming_term_count;
  return (
    <>
      <span className="mt-1 block text-[13px] text-ink-soft">
        zapisanych: {next.attendee_count} · {terms} {pluralPl(terms, "termin", "terminy", "terminów")}
      </span>
      <span className="mt-0.5 block text-[13px] font-bold text-ink">
        nast.: {dayjs(next.occurs_on).format("dd D MMM, HH:mm")}
      </span>
    </>
  );
}

/** CIRCLES primary: `cards` gives every circle a card with its seat map
 * (circle, pitch or table), `featured` spotlights the only one. */
export function CirclesGridBlock({ data, variant }: BlockProps) {
  const circles = data.directory?.circles ?? [];
  const slug = data.organization.slug;
  if (circles.length === 0) return null;

  if (variant === "featured") {
    const circle = circles[0];
    return (
      <section className="px-6 pt-6">
        <h2 className="mb-3 font-serif text-xl font-semibold text-ink">Nasza grupa</h2>
        <div className="rounded-2xl border border-line bg-paper p-4">
          {circle.next_term && (
            <div className="mb-3">
              <CircleVisualMini layoutMode={circle.layout_mode} attendeeCount={circle.next_term.attendee_count} />
            </div>
          )}
          <p className="text-[15px] font-extrabold text-ink">{circle.name}</p>
          <CircleFacts circle={circle} />
          <Link
            to={circleHref(slug, circle)}
            className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl bg-primary px-5 text-[15px] font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Zobacz zajęcia →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="px-6 pt-6">
      <h2 className="mb-3 font-serif text-2xl font-bold text-ink">Nasze grupy</h2>
      <ul className="flex flex-col gap-4">
        {circles.map((circle, index) => (
          <li key={circle.id} className="overflow-hidden rounded-[28px] border border-line bg-paper">
            <div className={`relative p-3 ${index % 2 === 0 ? "bg-primary-soft" : "bg-accent-soft"}`}>
              {circle.next_term && circle.next_term.attendee_count > 0 ? (
                <CircleVisualMini
                  layoutMode={circle.layout_mode}
                  attendeeCount={circle.next_term.attendee_count}
                  className="bg-transparent"
                />
              ) : (
                <div className="flex h-28 items-center justify-center">
                  <GroupsIcon aria-hidden="true" className="h-10 w-10 text-primary-fg" />
                </div>
              )}
              <span className="absolute top-3 left-3 rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-ink">
                {LAYOUT_LABEL[circle.layout_mode]}
              </span>
            </div>
            <div className="p-4">
              <h3 className="font-serif text-xl font-bold text-ink">{circle.name}</h3>
              <CircleFacts circle={circle} />
              <Link
                to={circleHref(slug, circle)}
                aria-label={`Zobacz grupę ${circle.name}`}
                className="mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-primary px-5 text-[15px] font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Zobacz grupę
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
