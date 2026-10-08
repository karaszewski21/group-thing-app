import type { ComponentType } from "react";
import { FooterBlock } from "./blocks/FooterBlock";
import { GhostBlock } from "./blocks/GhostBlock";
import { HeroBlock } from "./blocks/HeroBlock";
import { LinkStackBlock } from "./blocks/LinkStackBlock";
import { ShareBlock } from "./blocks/ShareBlock";
import type { BlockId, BlockProps, OrganizerPageData, PageLayoutDefinition, RenderMode } from "./layouts/types";

/** `null` = no content source yet: skipped for visitors, a ghost for the owner. */
const BLOCKS: Record<BlockId, ComponentType<BlockProps> | null> = {
  hero: HeroBlock,
  share: ShareBlock,
  about: null,
  "link-stack": LinkStackBlock,
  footer: FooterBlock,
};

interface LayoutRendererProps {
  layout: PageLayoutDefinition;
  data: OrganizerPageData;
  mode: RenderMode;
}

/** Renders a layout's blocks in order inside its frame. The root is `flex-1`
 * so it fills the page wrapper, which owns the viewport-height rule. */
export function LayoutRenderer({ layout, data, mode }: LayoutRendererProps) {
  const centered = layout.frame === "centered";

  return (
    <div
      data-frame={layout.frame}
      className={`flex flex-1 flex-col bg-cream font-sans text-ink ${
        centered ? "justify-center bg-gradient-to-b from-primary-soft to-cream to-40% py-8" : ""
      }`}
    >
      <div className="mx-auto w-full max-w-[430px]">
        {layout.blocks.map((slot, index) => {
          const Block = BLOCKS[slot.block];
          const key = `${slot.block}-${index}`;
          if (Block) return <Block key={key} data={data} variant={slot.variant} />;
          return mode === "owner-edit" ? <GhostBlock key={key} block={slot.block} /> : null;
        })}
      </div>
    </div>
  );
}
