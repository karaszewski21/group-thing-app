import { EyeIcon } from "../../panel/panelIcons";
import type { BlockId } from "../layouts/types";

const GHOST_COPY: Partial<Record<BlockId, { title: string; body: string }>> = {
  about: {
    title: "Opis — wkrótce",
    body: "Tu pojawi się opis Twojej organizacji. Widzisz to tylko Ty.",
  },
};

/** Owner-only placeholder for a block without a content source yet. Plain,
 * non-focusable text: it offers no action. */
export function GhostBlock({ block }: { block: BlockId }) {
  const copy = GHOST_COPY[block];
  if (!copy) return null;

  return (
    <div className="px-6 pt-5">
      <div data-ghost={block} className="rounded-2xl border-[1.5px] border-dashed border-line px-4 py-5 text-ink-soft">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[13.5px] font-bold">{copy.title}</p>
          <EyeIcon c="currentColor" />
        </div>
        <p className="mt-1 text-[12.5px]">{copy.body}</p>
      </div>
    </div>
  );
}
