import { PhotoPlaceholder } from "../../../components/shared/Icons";

const CARD = "rounded-2xl border border-line bg-paper p-3 font-sans";

/** A sample term row with its sign-up button, in the draft palette. */
export function TermPreviewCard() {
  return (
    <div role="img" aria-label="Podgląd terminu w wybranych kolorach" className={CARD}>
      <div className="flex items-center gap-2.5">
        <div className="flex h-[46px] w-[46px] shrink-0 flex-col items-center justify-center rounded-[13px] bg-primary-soft text-ink">
          <span className="text-base font-extrabold leading-none">14</span>
          <span className="text-[10.5px] font-bold">paź</span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-ink">Muzyczne Maluchy</p>
          <p className="text-[12px] text-ink-soft">wt · 16:30</p>
        </div>
      </div>
      <div className="mt-2.5 rounded-full bg-primary px-3 py-2 text-center text-[12.5px] font-extrabold text-on-primary">
        Zapisz się →
      </div>
    </div>
  );
}

/** A sample product card with its status and exchange-type pills, in the draft palette. */
export function ProductPreviewCard() {
  return (
    <div role="img" aria-label="Podgląd produktu w wybranych kolorach" className={CARD}>
      <div className="flex h-[52px] items-center justify-center rounded-xl bg-cream">
        <PhotoPlaceholder />
      </div>
      <p className="mt-2 truncate text-[13px] font-bold text-ink">Kask rowerowy</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-extrabold text-primary-fg">Dostępna</span>
        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-extrabold text-ink">Oddam</span>
      </div>
    </div>
  );
}

export function PreviewCards() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <TermPreviewCard />
      <ProductPreviewCard />
    </div>
  );
}
