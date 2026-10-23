/** Shared Tailwind classes of the public term page, its dialogs and the
 * sheets that reuse their look. Sizes are separate so a call site can pick
 * its own without two padding utilities competing. */

/** The page behind the term views, in the (organizer-themed) tokens. */
export const PAGE_SHELL = "flex flex-1 flex-col bg-cream font-sans text-ink";

export const BTN_PRIMARY =
  "rounded-full border-0 bg-primary font-extrabold text-on-primary disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
export const BTN_GHOST =
  "rounded-full border-[1.5px] border-line bg-transparent font-bold text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
export const BTN_SM = "px-3.5 py-1.75 text-xs";
export const BTN_LG = "px-3.5 py-2.5 text-[13px]";

export const FIELD =
  "min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-cream px-2.5 py-2 font-[inherit] text-[13px] text-ink focus:border-focus-ring focus:shadow-[0_0_0_3px_var(--color-primary-soft)] focus:outline-none";

export const ERROR_TEXT = "mb-2.5 text-xs text-danger";
export const STATUS_LINE = "mt-2 text-xs font-bold text-ink-soft";
/** A form revealed under a row (guest merge, RSVP account banner). */
export const SUB_FORM = "mt-2.5 border-t border-dashed border-line pt-2.5";
export const CARD = "rounded-3xl border border-line bg-paper p-4";
