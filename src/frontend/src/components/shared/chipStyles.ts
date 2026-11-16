export const FOCUS_CLASS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
export const CHIP_CLASS = `min-h-11 rounded-full border-[1.5px] px-3.5 text-sm font-bold ${FOCUS_CLASS}`;

/** A chip's colours: `set` for the pressed or filled one. */
export const chipTone = (set: boolean) =>
  set ? "border-primary bg-primary-soft text-ink" : "border-line bg-paper text-ink";
