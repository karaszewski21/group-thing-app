import { type ComponentType, type ReactNode } from "react";
import { AboutBlock, isAboutEmpty } from "./blocks/AboutBlock";
import { BlockSkeleton } from "../../components/shared/BlockSkeleton";
import { EmptyStateBlock } from "./blocks/EmptyStateBlock";
import { GalleryBlock, isGalleryEmpty } from "./blocks/GalleryBlock";
import { GhostBlock } from "./blocks/GhostBlock";
import { GroupsGridBlock, isGroupsGridEmpty } from "./blocks/GroupsGridBlock";
import { HeroBlock } from "./blocks/HeroBlock";
import { isItemStatsEmpty, ItemStatsBlock } from "./blocks/ItemStatsBlock";
import { LinkStackBlock } from "./blocks/LinkStackBlock";
import { isMeetingLinksEmpty, MeetingLinksBlock } from "./blocks/MeetingLinksBlock";
import { isNextDateCtaEmpty, NextDateCtaBlock } from "./blocks/NextDateCtaBlock";
import { isRecentItemsEmpty, RecentItemsBlock } from "./blocks/RecentItemsBlock";
import { ShareBlock } from "./blocks/ShareBlock";
import { isStatsEmpty, StatsBlock } from "./blocks/StatsBlock";
import { isUpcomingDatesEmpty, UpcomingDatesBlock } from "./blocks/UpcomingDatesBlock";
import { groupsOf } from "./layouts/layoutData";
import type {
  BlockId,
  BlockProps,
  BlockSlot,
  OrganizerPageData,
  PageLayoutDefinition,
  RenderMode,
} from "./layouts/types";

/** `Component: null` = no content source yet: skipped for visitors, a ghost
 * for the owner. `directory` blocks read `data.directory`, so they get a
 * skeleton while it loads and are hidden (visitor) or a neutral ghost (owner)
 * when it is unavailable, so their `isEmpty` is only asked once it is ready;
 * other blocks are asked right away. */
interface BlockDefinition {
  Component: ComponentType<BlockProps> | null;
  directory?: true;
  isEmpty?: (data: OrganizerPageData) => boolean;
}

const BLOCKS: Record<BlockId, BlockDefinition> = {
  hero: { Component: HeroBlock },
  share: { Component: ShareBlock },
  about: { Component: AboutBlock, isEmpty: isAboutEmpty },
  gallery: { Component: GalleryBlock, isEmpty: isGalleryEmpty },
  "link-stack": { Component: LinkStackBlock },
  footer: { Component: null },
  stats: { Component: StatsBlock, directory: true, isEmpty: isStatsEmpty },
  "upcoming-dates": { Component: UpcomingDatesBlock, directory: true, isEmpty: isUpcomingDatesEmpty },
  "next-date-cta": { Component: NextDateCtaBlock, directory: true, isEmpty: isNextDateCtaEmpty },
  "groups-grid": { Component: GroupsGridBlock, directory: true, isEmpty: isGroupsGridEmpty },
  "item-stats": { Component: ItemStatsBlock, directory: true, isEmpty: isItemStatsEmpty },
  "recent-items": { Component: RecentItemsBlock, directory: true, isEmpty: isRecentItemsEmpty },
  "meeting-links": { Component: MeetingLinksBlock, directory: true, isEmpty: isMeetingLinksEmpty },
};

const GRID_SKELETON_BLOCKS = new Set<BlockId>(["stats", "groups-grid", "item-stats", "recent-items"]);

/** Without a known group count (loading or unavailable), only the first slot
 * of a block id matches, so a single skeleton or ghost stands for its variants. */
function matchesWhen(slot: BlockSlot, index: number, slots: BlockSlot[], data: OrganizerPageData): boolean {
  if (!slot.when) return true;
  if (!data.directory) return slots.findIndex((other) => other.block === slot.block) === index;
  const groups = groupsOf(data.directory).length;
  const { minGroups, maxGroups } = slot.when;
  return (minGroups === undefined || groups >= minGroups) && (maxGroups === undefined || groups <= maxGroups);
}

interface LayoutRendererProps {
  layout: PageLayoutDefinition;
  data: OrganizerPageData;
  mode: RenderMode;
  heroAction?: ReactNode;
}

/** Renders a layout's blocks in order inside its frame. The root is `flex-1`
 * so it fills the page wrapper, which owns the viewport-height rule. The owner
 * never sees an empty state and visitors never see ghosts. */
export function LayoutRenderer({ layout, data, mode, heroAction }: LayoutRendererProps) {
  const centered = layout.frame === "centered";
  const owner = mode === "owner-edit";

  function renderSlot(slot: BlockSlot, key: string) {
    const { Component, directory, isEmpty } = BLOCKS[slot.block];
    const emptyState = (unavailable: boolean) =>
      slot.primary ? (
        <EmptyStateBlock key={key} layoutKey={layout.key} organization={data.organization} unavailable={unavailable} />
      ) : null;

    if (directory && data.directoryStatus === "loading") {
      return <BlockSkeleton key={key} shape={GRID_SKELETON_BLOCKS.has(slot.block) ? "grid" : "rows"} />;
    }
    if (directory && data.directoryStatus === "unavailable") {
      return owner ? <GhostBlock key={key} block={slot.block} slug={data.organization.slug} unavailable /> : emptyState(true);
    }
    if (isEmpty?.(data)) {
      return owner ? <GhostBlock key={key} block={slot.block} slug={data.organization.slug} /> : emptyState(false);
    }
    if (Component) {
      const action = slot.block === "hero" ? heroAction : undefined;
      return <Component key={key} data={data} variant={slot.variant} mode={mode} heroAction={action} />;
    }
    return owner ? <GhostBlock key={key} block={slot.block} slug={data.organization.slug} /> : null;
  }

  return (
    <div
      data-frame={layout.frame}
      className={`flex flex-1 flex-col font-sans ${centered ? "bg-primary pb-8 text-on-primary" : "bg-cream text-ink"}`}
    >
      <div className="mx-auto w-full max-w-[430px]">
        {layout.blocks.map((slot, index) =>
          matchesWhen(slot, index, layout.blocks, data) ? renderSlot(slot, `${slot.block}-${index}`) : null,
        )}
      </div>
    </div>
  );
}
