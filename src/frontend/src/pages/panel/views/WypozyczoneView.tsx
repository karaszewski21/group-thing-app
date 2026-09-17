import { GiftIcon } from "../panelIcons";
import { usePanelData } from "../panelDataStore";

export function WypozyczoneView() {
  const { borrowedItems, returnBorrowedItem } = usePanelData();

  return (
    <div>
      <div className="mb-3.5">
        <h2 className="text-[19px] font-semibold text-ink">Wypożyczone</h2>
        <small className="text-[12.5px] text-ink-soft">
          rzeczy od innych, które masz teraz u siebie
        </small>
      </div>
      <div className="rounded-[22px] border border-line bg-paper p-5">
        {borrowedItems.length === 0 && (
          <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
            Nie masz teraz nic pożyczonego.
          </div>
        )}
        {borrowedItems.map((b) => (
          <div key={b.itemId} className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
            <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl" style={{ background: "var(--color-teal-soft)" }}>
              <GiftIcon c="#245F61" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15.5px] font-semibold text-ink">{b.productName}</h3>
              <small className="mt-0.5 block text-[12.5px] text-ink-soft">Od: {b.lenderName}</small>
              {b.dueDate && (
                <small className="mt-0.5 block text-[12.5px] text-ink-soft">
                  Oddaj do: {new Date(b.dueDate).toLocaleDateString("pl-PL")}
                </small>
              )}
            </div>
            <button
              onClick={() => void returnBorrowedItem(b.itemId)}
              aria-label={`Oddaję ${b.productName}`}
              className="flex-none rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors hover:border-sage"
            >
              Oddaję
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
