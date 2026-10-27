import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import dayjs from "../../utils/dayjs";
import { SubPageHeader } from "../../components/shared/appComponents";
import { viewPath } from "../../utils/appHelpers";

const LABEL = "mb-1.5 block text-sm font-bold text-ink";
const INPUT =
  "h-12 w-full rounded-2xl border-[1.5px] border-line bg-paper px-4 text-base text-ink outline-none focus:border-focus-ring focus:ring-[3px] focus:ring-primary-soft";

interface EventDraft {
  name: string;
  date: string;
  time: string;
  place: string;
  description: string;
}

const EMPTY: EventDraft = { name: "", date: "", time: "", place: "", description: "" };

/** "Nowe wydarzenie" — a one-off meeting (a picnic, a birthday), reached from
 * /dodaj. MOCK: the backend has no events yet, so saving only shows a
 * confirmation; nothing is stored. */
export function EventCreateView() {
  const [draft, setDraft] = useState<EventDraft>(EMPTY);
  const [saved, setSaved] = useState<EventDraft | null>(null);
  const [touchedDate, setTouchedDate] = useState(false);

  const today = dayjs().format("YYYY-MM-DD");
  const dateInPast = draft.date !== "" && draft.date < today;
  const valid = draft.name.trim() !== "" && draft.date !== "" && !dateInPast;
  const set = (key: keyof EventDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSaved({ ...draft, name: draft.name.trim() });
    setDraft(EMPTY);
    setTouchedDate(false);
  }

  if (saved) {
    const when = dayjs(`${saved.date}T${saved.time || "00:00"}`);
    return (
      <>
        <SubPageHeader title="Nowe wydarzenie" backTo={viewPath("dodaj")} backLabel="Wróć do dodawania" />
        <div role="status" className="flex flex-col items-center gap-2.5 rounded-[28px] bg-primary-soft px-5 py-7 text-center">
          <p className="font-serif text-[22px] font-extrabold text-ink">Wydarzenie zapisane</p>
          <p className="text-base font-bold text-ink">{saved.name}</p>
          <p className="text-sm text-ink-soft">
            {when.format(saved.time ? "dddd, D MMMM · H:mm" : "dddd, D MMMM")}
            {saved.place ? ` · ${saved.place}` : ""}
          </p>
          <p className="max-w-70 text-[13px] text-ink-soft">To wersja próbna — wydarzenie nie trafia jeszcze do Spotkań.</p>
        </div>
        <div className="mt-4 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setSaved(null)}
            className="min-h-12 rounded-full bg-primary text-[15px] font-extrabold text-on-primary"
          >
            Dodaj kolejne
          </button>
          <Link
            to={viewPath("dodaj")}
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
      <SubPageHeader title="Nowe wydarzenie" backTo={viewPath("dodaj")} backLabel="Wróć do dodawania" />
      <p className="-mt-2 mb-4 text-[15px] leading-snug text-ink-soft">
        Jednorazowe spotkanie, np. piknik, urodziny albo wspólny spacer.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="wydarzenie-nazwa" className={LABEL}>
            Nazwa
          </label>
          <input
            id="wydarzenie-nazwa"
            value={draft.name}
            onChange={(e) => set("name")(e.target.value)}
            maxLength={120}
            placeholder="Np. Piknik w parku"
            className={INPUT}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="wydarzenie-data" className={LABEL}>
              Data
            </label>
            <input
              id="wydarzenie-data"
              type="date"
              min={today}
              value={draft.date}
              onChange={(e) => set("date")(e.target.value)}
              onBlur={() => setTouchedDate(true)}
              aria-invalid={touchedDate && dateInPast}
              aria-describedby={touchedDate && dateInPast ? "wydarzenie-data-blad" : undefined}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="wydarzenie-godzina" className={LABEL}>
              Godzina
            </label>
            <input
              id="wydarzenie-godzina"
              type="time"
              value={draft.time}
              onChange={(e) => set("time")(e.target.value)}
              className={INPUT}
            />
          </div>
        </div>
        {touchedDate && dateInPast && (
          <p id="wydarzenie-data-blad" role="alert" className="-mt-2 text-[13px] font-bold text-danger">
            Data nie może być w przeszłości.
          </p>
        )}

        <div>
          <label htmlFor="wydarzenie-miejsce" className={LABEL}>
            Miejsce
          </label>
          <input
            id="wydarzenie-miejsce"
            value={draft.place}
            onChange={(e) => set("place")(e.target.value)}
            maxLength={200}
            placeholder="Np. Park Szczęśliwicki, przy placu zabaw"
            className={INPUT}
          />
        </div>

        <div>
          <label htmlFor="wydarzenie-opis" className={LABEL}>
            Opis
          </label>
          <textarea
            id="wydarzenie-opis"
            value={draft.description}
            onChange={(e) => set("description")(e.target.value)}
            maxLength={1000}
            placeholder="Co planujecie, co warto zabrać"
            className={`${INPUT} min-h-24 resize-y py-3`}
          />
        </div>

        <button
          type="submit"
          disabled={!valid}
          className="mt-1 min-h-13 rounded-full bg-primary text-base font-extrabold text-on-primary disabled:opacity-60"
        >
          Zapisz wydarzenie
        </button>
      </form>
    </>
  );
}
