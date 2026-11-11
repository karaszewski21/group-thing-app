import { groupsOf } from "../layouts/layoutData";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { GroupCard, GroupTermsLink, NextTermLink } from "./GroupCard";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isGroupsGridEmpty(data: OrganizerPageData): boolean {
  return groupsOf(data.directory).length === 0;
}

/** The owner's newest groups as big tiles, each with a link to its next
 * term (when it has one) and to the group's page with all its terms.
 * `cards` (2+ groups) lists them under "Nasze grupy";
 * `featured` (a single group) spotlights it as "Nasza grupa". */
export function GroupsGridBlock({ data, variant }: BlockProps) {
  const groups = groupsOf(data.directory);
  const slug = data.organization.slug;
  if (groups.length === 0) return null;
  const featured = variant === "featured";
  const shown = featured ? groups.slice(0, 1) : groups;

  return (
    <section className="px-6 pt-6">
      <h2 className={`mb-3 font-serif text-ink ${featured ? "text-xl font-semibold" : "text-2xl font-bold"}`}>
        {featured ? "Nasza grupa" : "Nasze grupy"}
      </h2>
      <ul className="flex flex-col gap-4">
        {shown.map((group, index) => (
          <li key={group.id}>
            <GroupCard group={group} tone={index % 2 === 0 ? "primary" : "accent"}>
              <NextTermLink slug={slug} group={group} />
              <GroupTermsLink slug={slug} group={group} />
            </GroupCard>
          </li>
        ))}
      </ul>
    </section>
  );
}
