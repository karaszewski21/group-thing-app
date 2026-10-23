import { useState, type FormEvent } from "react";
import { pluralPl } from "../../utils/plural";
import { BellIcon, SearchIcon, TrashIcon } from "../../components/shared/appIcons";
import { capitalize, ITEM_MODE_TONE, ITEM_MODES } from "../../utils/appHelpers";
import { MOCK_WANTS, type MockWant } from "../../utils/mocks";

/** "Szukam" — things the user is looking for. MOCK: kept in local state
 * only (lost on refresh) until the backend stores wanted items. */
export function WantedView() {
  const [wants, setWants] = useState<MockWant[]>(MOCK_WANTS);
  const [draft, setDraft] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    setWants((list) => [{ id: crypto.randomUUID(), name, modes: [...ITEM_MODES], matches: 0 }, ...list]);
    setDraft("");
  }

  return (
    <>
      <h1 className="font-serif text-[30px] leading-tight font-extrabold tracking-tight text-ink">Szukam</h1>
      <p className="mt-1 mb-4 text-[15px] leading-snug text-ink-soft">
        Zapisz, czego potrzebujesz. Damy znać, gdy ktoś doda pasującą rzecz.
      </p>

      <form onSubmit={add} className="mb-4 flex gap-2">
        <label htmlFor="szukam-nowa" className="sr-only">
          Czego szukasz?
        </label>
        <input
          id="szukam-nowa"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={120}
          placeholder="Np. fotelik 9–18 kg"
          className="min-h-12 min-w-0 flex-1 rounded-full border-[1.5px] border-line bg-paper px-4 text-base text-ink focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="min-h-12 flex-none rounded-full bg-primary px-5 text-[15px] font-extrabold text-on-primary disabled:opacity-60"
        >
          Dodaj
        </button>
      </form>

      {wants.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-[28px] border-[1.5px] border-dashed border-line-strong bg-paper px-5 py-7 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-soft text-accent-fg">
            <SearchIcon c="currentColor" />
          </span>
          <p className="font-serif text-[22px] font-extrabold text-ink">Czego potrzebujesz?</p>
          <p className="max-w-70 text-[15px] leading-snug text-ink-soft">
            Wpisz rzecz, której szukasz, np. fotelik albo kurtkę na zimę.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {wants.map((w) => (
            <li key={w.id} className="flex flex-col gap-3 rounded-[22px] border border-line bg-paper p-3.5">
              <div className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <h2 className="text-base font-bold wrap-break-word text-ink">{w.name}</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {w.modes.map((m) => (
                      <span key={m} className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${ITEM_MODE_TONE[m]}`}>
                        {capitalize(m)}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setWants((list) => list.filter((x) => x.id !== w.id))}
                  aria-label={`Usuń: ${w.name}`}
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-full border-[1.5px] border-line text-ink-soft hover:text-danger"
                >
                  <TrashIcon />
                </button>
              </div>
              {w.matches > 0 ? (
                <p className="rounded-2xl bg-primary-soft px-3 py-2.5 text-sm font-extrabold text-primary-fg">
                  {w.matches} {pluralPl(w.matches, "pasująca rzecz", "pasujące rzeczy", "pasujących rzeczy")}
                </p>
              ) : (
                <p className="flex items-center gap-2 rounded-2xl bg-cream px-3 py-2.5 text-sm text-ink">
                  <BellIcon c="currentColor" /> Jeszcze nic · powiadomimy Cię
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
