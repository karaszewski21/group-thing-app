import type { ReactNode } from "react";
import type { GroupLayoutMode } from "../../../api/groups";
import type { OrganizationGroup } from "../../../api/organizations";
import { GroupsIcon } from "../../../components/shared/Icons";
import { Link } from "../../../routing/navigation";
import { groupTermsPath } from "../../../routing/paths";
import dayjs from "../../../utils/dayjs";
import { pluralPl } from "../../../utils/plural";
import { organizerTermPath } from "../organizerHelpers";
import { CircleVisualMini } from "./CircleVisualMini";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

const LAYOUT_LABEL: Record<GroupLayoutMode, string> = { CIRCLE: "Krąg", PITCH: "Boisko", TABLE: "Stół" };

function GroupFacts({ group }: { group: OrganizationGroup }) {
  const next = group.next_term;
  if (!next) return <span className="mt-1 block text-[13px] text-ink-soft">brak zaplanowanych terminów</span>;
  const terms = group.upcoming_term_count;
  return (
    <>
      <span className="mt-1 block text-[13px] font-bold text-ink">
        najbliższy: {dayjs(next.occurs_on).format("dd D MMM, HH:mm")}
      </span>
      <span className="mt-0.5 block text-[13px] text-ink-soft">
        {terms} {pluralPl(terms, "termin", "terminy", "terminów")} · zapisanych: {next.attendee_count}
      </span>
    </>
  );
}

/** "Zobacz najbliższy termin": only a group with an upcoming term gets it. */
export function NextTermLink({ slug, group }: { slug: string; group: OrganizationGroup }) {
  if (!group.next_term) return null;
  return (
    <Link
      to={organizerTermPath(slug, group.id, group.next_term.id)}
      aria-label={`Zobacz najbliższy termin grupy ${group.name}`}
      className={`mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-primary px-5 text-[15px] font-extrabold text-on-primary ${FOCUS_RING}`}
    >
      Zobacz najbliższy termin →
    </Link>
  );
}

/** The quiet link to the group's page with all of its terms. */
export function GroupTermsLink({ slug, group }: { slug: string; group: OrganizationGroup }) {
  return (
    <Link
      to={groupTermsPath(slug, group.id)}
      aria-label={`Wszystkie terminy grupy ${group.name}`}
      className={`mt-1 flex min-h-[44px] items-center justify-center text-[13px] font-bold text-primary-fg ${FOCUS_RING}`}
    >
      Wszystkie terminy grupy →
    </Link>
  );
}

interface GroupCardProps {
  group: OrganizationGroup;
  /** Alternating panel tone of a list of cards. */
  tone?: "primary" | "accent";
  /** The group page's own card is its `h1`. */
  headingLevel?: 1 | 3;
  /** Full text under the name; only the group's own page passes it. */
  description?: string | null;
  children?: ReactNode;
}

/** The big group tile: the seat map of the next term (circle, pitch or
 * table) or an icon, the layout label, the name, the optional description,
 * the next term with the term and sign-up counts, then the actions passed as `children`. */
export function GroupCard({ group, tone = "primary", headingLevel = 3, description, children }: GroupCardProps) {
  const Heading = headingLevel === 1 ? "h1" : "h3";
  return (
    <div className="overflow-hidden rounded-[28px] border border-line bg-paper">
      <div className={`relative p-3 ${tone === "primary" ? "bg-primary-soft" : "bg-accent-soft"}`}>
        {group.next_term && group.next_term.attendee_count > 0 ? (
          <CircleVisualMini
            layoutMode={group.layout_mode}
            attendeeCount={group.next_term.attendee_count}
            className="bg-transparent"
          />
        ) : (
          <div className="flex h-28 items-center justify-center">
            <GroupsIcon aria-hidden="true" className="h-10 w-10 text-primary-fg" />
          </div>
        )}
        <span className="absolute top-3 left-3 rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-ink">
          {LAYOUT_LABEL[group.layout_mode]}
        </span>
      </div>
      <div className="p-4">
        <Heading className="font-serif text-xl font-bold text-ink">{group.name}</Heading>
        {description && (
          <p className="mt-2 mb-1.5 text-sm leading-normal whitespace-pre-line text-ink">{description}</p>
        )}
        <GroupFacts group={group} />
        {children}
      </div>
    </div>
  );
}
