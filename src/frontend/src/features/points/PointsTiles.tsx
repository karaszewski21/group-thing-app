function Tile({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div className="flex-1 rounded-2xl border border-line bg-cream p-3.5 text-center">
      <b className="block font-serif text-[28px] font-extrabold text-ink">{value ?? "–"}</b>{" "}
      <span className="text-[12.5px] text-ink-soft">{label}</span>
    </div>
  );
}

type PointsTilesProps =
  | { balance: number | undefined; reputation: number | undefined; withHeld?: false }
  | { balance: number | undefined; reputation: number | undefined; withHeld: true; held: number | undefined };

/** The owner's balance and reputation side by side; „–” while unknown.
 * `withHeld` (the /points page) adds the held points between them. */
export function PointsTiles(props: PointsTilesProps) {
  if (props.withHeld) {
    return (
      <div className="flex gap-2.5">
        <Tile value={props.balance} label="dostępne" />
        <Tile value={props.held} label="zablokowane" />
        <Tile value={props.reputation} label="reputacja" />
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <Tile value={props.balance} label="punktów" />
      <Tile value={props.reputation} label="reputacji" />
    </div>
  );
}
