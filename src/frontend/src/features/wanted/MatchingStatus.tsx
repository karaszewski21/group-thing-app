/** A decorative spinner that stands still under reduced motion. */
function Spinner({ size }: { size: "sm" | "md" }) {
  const dims = size === "md" ? "h-[22px] w-[22px] border-[3px]" : "h-3.5 w-3.5 border-2";
  return (
    <span
      aria-hidden="true"
      className={`flex-none animate-spin rounded-full border-primary-soft border-t-primary motion-reduce:animate-none ${dims}`}
    />
  );
}

/** The want page's row while the matcher has yet to answer the want. */
export function MatchingStatus() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3.5 flex items-center gap-2.5 rounded-[20px] border border-line bg-paper p-3.5 text-[15px] font-semibold text-ink"
    >
      <Spinner size="md" />
      <span>
        Szukamy pasujących rzeczy…
        <small className="block text-[13px] font-normal text-ink-soft">To zwykle kilka sekund.</small>
      </span>
    </div>
  );
}

/** The list card's short form of {@link MatchingStatus}, in place of the counts. */
export function MatchingBadge() {
  return (
    <p role="status" className="flex items-center gap-1.5 rounded-2xl bg-cream px-3 py-2.5 text-sm font-bold text-ink-soft">
      <Spinner size="sm" />
      Szukamy…
    </p>
  );
}
