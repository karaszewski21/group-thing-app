import dayjs from "../../../utils/dayjs";

/** The TermPreviewCard date tile: day number over the short month, or with
 * `weekday` the short month, day number and short weekday. */
export function DateTile({
  occursOn,
  className = "bg-primary-soft text-ink",
  weekday = false,
}: {
  occursOn: string;
  className?: string;
  weekday?: boolean;
}) {
  const date = dayjs(occursOn);
  if (weekday) {
    return (
      <div
        aria-hidden="true"
        className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-2xl py-1.5 ${className}`}
      >
        <span className="text-[11px] font-bold uppercase">{date.format("MMM")}</span>
        <span className="text-[22px] font-extrabold leading-none">{date.format("D")}</span>
        <span className="text-[11px] font-bold uppercase">{date.format("ddd")}</span>
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`flex h-[46px] w-[46px] shrink-0 flex-col items-center justify-center rounded-[13px] ${className}`}
    >
      <span className="text-base font-extrabold leading-none">{date.format("D")}</span>
      <span className="text-[10.5px] font-bold">{date.format("MMM")}</span>
    </div>
  );
}
