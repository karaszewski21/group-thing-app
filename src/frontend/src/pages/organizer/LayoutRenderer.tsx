import type { ComponentType } from "react";
import { AgendaBlock, isAgendaEmpty } from "./blocks/AgendaBlock";
import { BlockSkeleton } from "./blocks/BlockSkeleton";
import { CirclesGridBlock, isCirclesGridEmpty } from "./blocks/CirclesGridBlock";
import { EmptyStateBlock } from "./blocks/EmptyStateBlock";
import { ExchangeBoardBlock, isExchangeBoardEmpty } from "./blocks/ExchangeBoardBlock";
import { ExchangeCountsBlock, isExchangeCountsEmpty } from "./blocks/ExchangeCountsBlock";
import { FooterBlock } from "./blocks/FooterBlock";
import { GhostBlock } from "./blocks/GhostBlock";
import { HeroBlock } from "./blocks/HeroBlock";
import { LinkStackBlock } from "./blocks/LinkStackBlock";
import { isNeededItemsEmpty, NeededItemsBlock } from "./blocks/NeededItemsBlock";
import { isNextTermCtaEmpty, NextTermCtaBlock } from "./blocks/NextTermCtaBlock";
import { ShareBlock } from "./blocks/ShareBlock";
import { isStatsEmpty, StatsBlock } from "./blocks/StatsBlock";
import { isUpcomingTermsEmpty, UpcomingTermsBlock } from "./blocks/UpcomingTermsBlock";
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
 * when it is unavailable. `isEmpty` is only asked once the directory is ready. */
interface BlockDefinition {
  Component: ComponentType<BlockProps> | null;
  directory?: true;
  isEmpty?: (data: OrganizerPageData) => boolean;
}

const BLOCKS: Record<BlockId, BlockDefinition> = {
  hero: { Component: HeroBlock },
  share: { Component: ShareBlock },
  about: { Component: null },
  "link-stack": { Component: LinkStackBlock },
  footer: { Component: FooterBlock },
  stats: { Component: StatsBlock, directory: true, isEmpty: isStatsEmpty },
  "upcoming-terms": { Component: UpcomingTermsBlock, directory: true, isEmpty: isUpcomingTermsEmpty },
  "next-term-cta": { Component: NextTermCtaBlock, directory: true, isEmpty: isNextTermCtaEmpty },
  agenda: { Component: AgendaBlock, directory: true, isEmpty: isAgendaEmpty },
  "circles-grid": { Component: CirclesGridBlock, directory: true, isEmpty: isCirclesGridEmpty },
  "exchange-counts": { Component: ExchangeCountsBlock, directory: true, isEmpty: isExchangeCountsEmpty },
  "exchange-board": { Component: ExchangeBoardBlock, directory: true, isEmpty: isExchangeBoardEmpty },
  "needed-items": { Component: NeededItemsBlock, directory: true, isEmpty: isNeededItemsEmpty },
};

const GRID_SKELETON_BLOCKS = new Set<BlockId>(["stats", "circles-grid", "exchange-counts", "exchange-board"]);

/** Without a known circle count (loading or unavailable), only the first slot
 * of a block id matches, so a single skeleton or ghost stands for its variants. */
function matchesWhen(slot: BlockSlot, index: number, slots: BlockSlot[], data: OrganizerPageData): boolean {
  if (!slot.when) return true;
  if (!data.directory) return slots.findIndex((other) => other.block === slot.block) === index;
  const circles = data.directory.circles.length;
  const { minCircles, maxCircles } = slot.when;
  return (minCircles === undefined || circles >= minCircles) && (maxCircles === undefined || circles <= maxCircles);
}

interface LayoutRendererProps {
  layout: PageLayoutDefinition;
  data: OrganizerPageData;
  mode: RenderMode;
}

/** Renders a layout's blocks in order inside its frame. The root is `flex-1`
 * so it fills the page wrapper, which owns the viewport-height rule. The owner
 * never sees an empty state and visitors never see ghosts. */
export function LayoutRenderer({ layout, data, mode }: LayoutRendererProps) {
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
      return owner ? <GhostBlock key={key} block={slot.block} unavailable /> : emptyState(true);
    }
    if (data.directoryStatus === "ready" && isEmpty?.(data)) {
      return owner ? <GhostBlock key={key} block={slot.block} /> : emptyState(false);
    }
    if (Component) return <Component key={key} data={data} variant={slot.variant} mode={mode} />;
    return owner ? <GhostBlock key={key} block={slot.block} /> : null;
  }

  return (
    <div
      data-frame={layout.frame}
      className={`flex flex-1 flex-col bg-cream font-sans text-ink ${
        centered ? "justify-center bg-gradient-to-b from-primary-soft to-cream to-40% py-8" : ""
      }`}
    >
      <div className="mx-auto w-full max-w-[430px]">
        {layout.blocks.map((slot, index) =>
          matchesWhen(slot, index, layout.blocks, data) ? renderSlot(slot, `${slot.block}-${index}`) : null,
        )}
      </div>
    </div>
  );
}
