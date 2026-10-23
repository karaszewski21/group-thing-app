import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import dayjs from "../../utils/dayjs";
import { EyeIcon, GiftIcon } from "../../components/shared/appIcons";
import { useAppData } from "../../app/appDataStore";

type Tab = "od-innych" | "innym";

const TABS: { id: Tab; label: string }[] = [
  { id: "od-innych", label: "Wypożyczone od innych" },
  { id: "innym", label: "Wypożyczone innym" },
];

export function BorrowedView() {
  const { borrowedItems, returnBorrowedItem, lentOutItems } = useAppData();
  const [tab, setTab] = useState<Tab>("od-innych");

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-serif text-[32px] leading-tight font-extrabold tracking-tight text-ink">Wypożyczone</h1>
        <small className="text-sm text-ink-soft">
          {tab === "od-innych" ? "rzeczy od innych, które masz teraz u siebie" : "twoje rzeczy, które są teraz u innych"}
        </small>
      </div>
      <div role="tablist" aria-label="Wypożyczone" className="mb-4 flex flex-wrap gap-2">
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
              className={`min-h-10 rounded-full px-4 text-sm font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                on ? "bg-ink text-on-ink" : "border-[1.5px] border-line bg-paper text-ink-soft hover:text-ink"
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
        className="flex flex-col gap-3"
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
                  className="min-h-10 rounded-full bg-primary px-4 text-sm font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
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
    <div className="flex flex-col items-center gap-2 rounded-[22px] border border-dashed border-line bg-paper px-5 py-8 text-center text-sm text-ink-soft">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cream text-ink-soft">
        <GiftIcon c="currentColor" />
      </span>
      {text}
    </div>
  );
}

/** One loan: the item, who has it or lent it, the due date, and the actions. */
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
    <div className="rounded-[22px] border border-line bg-paper p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-teal-soft text-ink">
          <GiftIcon c="currentColor" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 title={productName} className="line-clamp-2 text-base leading-snug font-bold wrap-break-word text-ink">{productName}</h3>
          <small className="mt-0.5 block text-[13px] text-ink-soft">{who}</small>
        </div>
        <Link
          to={`/product/${itemId}`}
          aria-label={`Zobacz rzecz ${productName}`}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full border-[1.5px] border-line text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <EyeIcon />
        </Link>
      </div>
      {(dueDate || children) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {dueDate ? (
            <small className="rounded-full bg-accent-soft px-3 py-1 text-[13px] font-extrabold text-accent-fg">
              {dueLabel}: {dayjs(dueDate).format("DD.MM.YYYY")}
            </small>
          ) : (
            <span />
          )}
          {children}
        </div>
      )}
    </div>
  );
}
