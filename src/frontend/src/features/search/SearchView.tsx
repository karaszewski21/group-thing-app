import { useState } from "react";
import { Link } from "react-router-dom";
import { pluralPl } from "../../utils/plural";
import { ItemTile, MeetingRow } from "../../components/shared/appComponents";
import { BackIcon, CloseIcon, SearchIcon } from "../../components/shared/appIcons";
import { matchesQuery, MOCK_SEARCH_ITEMS, MOCK_SEARCH_MEETINGS } from "../../utils/mocks";

type Scope = "rzeczy" | "spotkania";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "rzeczy", label: "Rzeczy" },
  { id: "spotkania", label: "Spotkania" },
];

/** Global search over items and meetings. Results come from MOCK data until
 * the backend has a search endpoint (see utils/mocks.ts). */
export function SearchView() {
  const [scope, setScope] = useState<Scope>("rzeczy");
  const [query, setQuery] = useState("");
  const q = query.trim();

  const items = q ? MOCK_SEARCH_ITEMS.filter((i) => matchesQuery(i.name, q)) : MOCK_SEARCH_ITEMS;
  const meetings = q
    ? MOCK_SEARCH_MEETINGS.filter((m) => matchesQuery(`${m.group} ${m.organizer}`, q))
    : MOCK_SEARCH_MEETINGS;
  const count = scope === "rzeczy" ? items.length : meetings.length;
  const summary = q
    ? `${count} ${
        scope === "rzeczy"
          ? pluralPl(count, "rzecz", "rzeczy", "rzeczy")
          : pluralPl(count, "spotkanie", "spotkania", "spotkań")
      } dla „${q}”`
    : scope === "rzeczy"
      ? "Najnowsze rzeczy w okolicy"
      : "Nadchodzące spotkania w okolicy";

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Link
          to="/"
          aria-label="Wróć na Start"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <BackIcon />
        </Link>
        <div className="flex min-h-12.5 min-w-0 flex-1 items-center gap-2 rounded-full border-2 border-primary bg-paper pr-1.5 pl-4">
          <SearchIcon />
          <label htmlFor="panel-search" className="sr-only">
            {scope === "rzeczy" ? "Szukaj rzeczy" : "Szukaj spotkań"}
          </label>
          <input
            id="panel-search"
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={scope === "rzeczy" ? "Np. wózek, kurtka 104, klocki" : "Np. rytmika, joga, sensoryka"}
            className="h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-soft [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Wyczyść"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-cream text-ink"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      <div role="tablist" aria-label="Czego szukasz" className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-line p-1">
        {SCOPES.map((s) => {
          const on = scope === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={`szukaj-tab-${s.id}`}
              aria-selected={on}
              aria-controls="szukaj-wyniki"
              onClick={() => setScope(s.id)}
              className={`min-h-10 rounded-full text-[15px] font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                on ? "bg-paper text-ink shadow-[0_2px_8px_-2px_rgba(42,35,32,0.25)]" : "text-ink-soft hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="szukaj-wyniki" aria-labelledby={`szukaj-tab-${scope}`}>
        <p aria-live="polite" className="mb-3 text-sm text-ink-soft">
          {summary}
        </p>
        {count === 0 ? (
          <div className="rounded-[22px] border border-dashed border-line-strong bg-paper p-6 text-center text-sm text-ink-soft">
            Nic nie znaleźliśmy. Spróbuj innego słowa.
          </div>
        ) : scope === "rzeczy" ? (
          <div className="grid grid-cols-2 gap-3">
            {items.map((item) => (
              <ItemTile key={item.id} name={item.name} owner={item.owner} mode={item.mode} />
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {meetings.map((m) => (
              <li key={m.id}>
                <MeetingRow meeting={m} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
