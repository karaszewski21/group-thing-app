function Tile({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div className="flex-1 rounded-2xl border border-line bg-cream p-3.5 text-center">
      <b className="block font-serif text-[28px] font-extrabold text-ink">{value ?? "–"}</b>{" "}
      <span className="text-[12.5px] text-ink-soft">{label}</span>
    </div>
  );
}

/** The owner's balance and reputation side by side; „–” while unknown. */
export function PointsTiles({ balance, reputation }: { balance: number | undefined; reputation: number | undefined }) {
  return (
    <div className="flex gap-2.5">
      <Tile value={balance} label="punktów" />
      <Tile value={reputation} label="reputacji" />
    </div>
  );
}
