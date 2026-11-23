/** The small caps line over a meeting or directory result: what it is
 * („Termin”, „Grupa”…), „moja grupa” when the viewer belongs to it and a
 * term's „+N pkt” for attendance (shown only above 0). */
export function ResultKindLabel({ label, mine = false, points = 0 }: { label: string; mine?: boolean; points?: number }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-extrabold tracking-wide text-ink-soft uppercase">
      {label}
      {mine && " "}
      {mine && (
        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10.5px] tracking-normal text-primary-fg normal-case">
          moja grupa
        </span>
      )}
      {points > 0 && " "}
      {points > 0 && (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] tracking-normal text-accent-fg normal-case">
          +{points} pkt<span className="sr-only"> za obecność</span>
        </span>
      )}
    </span>
  );
}
