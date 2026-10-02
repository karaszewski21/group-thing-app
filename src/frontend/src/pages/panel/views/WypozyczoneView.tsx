import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import dayjs from "../../../utils/dayjs";
import { EyeIcon, GiftIcon } from "../panelIcons";
import { usePanelData } from "../panelDataStore";

type Tab = "od-innych" | "innym";

const TABS: { id: Tab; label: string }[] = [
  { id: "od-innych", label: "Wypożyczone od innych" },
  { id: "innym", label: "Wypożyczone innym" },
];

export function WypozyczoneView() {
  const { borrowedItems, returnBorrowedItem, lentOutItems } = usePanelData();
  const [tab, setTab] = useState<Tab>("od-innych");

  return (
    <div>
      <div className="mb-3.5">
        <h2 className="text-[19px] font-semibold text-ink">Wypożyczone</h2>
        <small className="text-[12.5px] text-ink-soft">
          {tab === "od-innych"
            ? "rzeczy od innych, które masz teraz u siebie"
            : "twoje rzeczy, które są teraz u innych"}
        </small>
      </div>
      <div role="tablist" aria-label="Wypożyczone" className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`wypozyczone-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`wypozyczone-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`rounded-full border-[1.5px] px-3.5 py-2 text-[12px] font-extrabold transition-colors ${
                on ? "border-transparent bg-ink text-[#EAF2E9]" : "border-line text-ink-soft hover:border-sage"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`wypozyczone-panel-${tab}`}
        aria-labelledby={`wypozyczone-tab-${tab}`}
        className="rounded-[22px] border border-line bg-paper p-5"
      >
        {tab === "od-innych" ? (
          <>
            {borrowedItems.length === 0 && <EmptyState text="Nie masz teraz nic pożyczonego." />}
            {borrowedItems.map((b) => (
              <LoanRow
                key={b.itemId}
                itemId={b.itemId}
                productName={b.productName}
                who={`Od: ${b.lenderName}`}
                dueDate={b.dueDate}
                dueLabel="Oddaj do"
              >
                <button
                  onClick={() => void returnBorrowedItem(b.itemId)}
                  aria-label={`Oddaję ${b.productName}`}
                  className="flex-none rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors hover:border-sage"
                >
                  Oddaję
                </button>
              </LoanRow>
            ))}
          </>
        ) : (
          <>
            {lentOutItems.length === 0 && <EmptyState text="Nikt nie ma teraz twoich rzeczy." />}
            {lentOutItems.map((it) => (
              <LoanRow
                key={it.id}
                itemId={it.id}
                productName={it.product_name}
                who={`U: ${it.lent_to_display_name}`}
                dueDate={it.lent_due_date}
                dueLabel="Zwrot do"
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
      {text}
    </div>
  );
}

function LoanRow({
  itemId,
  productName,
  who,
  dueDate,
  dueLabel,
  children,
}: {
  itemId: string;
  productName: string;
  who: string;
  dueDate: string | null;
  dueLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
      <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl" style={{ background: "var(--color-teal-soft)" }}>
        <GiftIcon c="#245F61" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15.5px] font-semibold text-ink">{productName}</h3>
        <small className="mt-0.5 block text-[12.5px] text-ink-soft">{who}</small>
        {dueDate && (
          <small className="mt-0.5 block text-[12.5px] text-ink-soft">
            {dueLabel}: {dayjs(dueDate).format("DD.MM.YYYY")}
          </small>
        )}
      </div>
      <Link
        to={`/product/${itemId}`}
        aria-label={`Zobacz rzecz ${productName}`}
        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
      >
        <EyeIcon />
      </Link>
      {children}
    </div>
  );
}
