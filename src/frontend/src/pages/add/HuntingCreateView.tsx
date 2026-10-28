import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { SubPageHeader } from "../../components/shared/appComponents";
import { viewPath } from "../../utils/appHelpers";

const LABEL = "mb-1.5 block text-sm font-bold text-ink";
const INPUT =
  "h-12 w-full rounded-2xl border-[1.5px] border-line bg-paper px-4 text-base text-ink outline-none focus:border-focus-ring focus:ring-[3px] focus:ring-primary-soft";

interface HuntingDraft {
  name: string;
  description: string;
}

const EMPTY: HuntingDraft = { name: "", description: "" };

/** "Szukam rzeczy" — an item the user is hunting for, reached from /add.
 * MOCK: nothing matches wanted items yet, so saving only shows a
 * confirmation; nothing is stored. */
export function HuntingCreateView() {
  const [draft, setDraft] = useState<HuntingDraft>(EMPTY);
  const [saved, setSaved] = useState<string | null>(null);

  const valid = draft.name.trim() !== "";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSaved(draft.name.trim());
    setDraft(EMPTY);
  }

  if (saved) {
    return (
      <>
        <SubPageHeader title="Szukam rzeczy" backTo={viewPath("add")} backLabel="Wróć do dodawania" />
        <div role="status" className="flex flex-col items-center gap-2.5 rounded-[28px] bg-teal-soft px-5 py-7 text-center">
          <p className="font-serif text-[22px] font-extrabold text-ink">Zapisane</p>
          <p className="text-base font-bold text-ink">{saved}</p>
          <p className="max-w-70 text-[13px] text-ink-soft">To wersja próbna — nie damy jeszcze znać, gdy ktoś doda pasującą rzecz.</p>
        </div>
        <div className="mt-4 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setSaved(null)}
            className="min-h-12 rounded-full bg-primary text-[15px] font-extrabold text-on-primary"
          >
            Dodaj kolejną
          </button>
          <Link
            to={viewPath("add")}
            className="flex min-h-12 items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-[15px] font-extrabold text-ink"
          >
            Gotowe
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <SubPageHeader title="Szukam rzeczy" backTo={viewPath("add")} backLabel="Wróć do dodawania" />
      <p className="-mt-2 mb-4 text-[15px] leading-snug text-ink-soft">
        Napisz, czego szukasz — damy znać, gdy ktoś doda pasującą rzecz.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="szukam-nazwa" className={LABEL}>
            Czego szukasz?
          </label>
          <input
            id="szukam-nazwa"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            maxLength={120}
            placeholder="Np. Kask rowerowy dla dziecka"
            className={INPUT}
          />
        </div>

        <div>
          <label htmlFor="szukam-opis" className={LABEL}>
            Szczegóły (opcjonalnie)
          </label>
          <textarea
            id="szukam-opis"
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            maxLength={1000}
            placeholder="Rozmiar, kolor, stan"
            className={`${INPUT} min-h-24 resize-y py-3`}
          />
        </div>

        <button
          type="submit"
          disabled={!valid}
          className="mt-1 min-h-13 rounded-full bg-primary text-base font-extrabold text-on-primary disabled:opacity-60"
        >
          Zapisz poszukiwanie
        </button>
      </form>
    </>
  );
}
