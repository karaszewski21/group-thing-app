/** A pulsing placeholder shape; decorative, so screen readers skip it. The
 * screen's own "Wczytywanie…" label lives in the parent's sr-only text. */
export function Skeleton({ className, tone = "neutral" }: { className: string; tone?: "neutral" | "primary" }) {
  const color = tone === "primary" ? "bg-primary-soft" : "bg-line";
  return <span aria-hidden="true" className={`block animate-pulse motion-reduce:animate-none ${color} ${className}`} />;
}

/** A white card holding a title bar and two text bars, used by the loading
 * screens for lists of terms, items and the like. */
export function SkeletonCard({ titleWidth = "w-2/5" }: { titleWidth?: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[22px] border border-line bg-paper p-4.5">
      <Skeleton className={`h-4 rounded-lg ${titleWidth}`} />
      <Skeleton className="h-3 w-[90%] rounded-md" />
      <Skeleton className="h-3 w-3/5 rounded-md" />
    </div>
  );
}
