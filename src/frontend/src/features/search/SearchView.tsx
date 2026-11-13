import { useCallback, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { SearchMode, SearchResult, SearchScope } from "../../api/search";
import { useAuth } from "../../auth/AuthContext";
import { CloseIcon, SearchIcon } from "../../components/shared/appIcons";
import { nextIndex } from "../../components/shared/rovingIndex";
import { useLoadMoreOnScroll } from "../../hooks/useLoadMoreOnScroll";
import { SEARCH_MAX_LENGTH, useSearch } from "../../hooks/useSearch";
import { Link } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";
import { pluralPl } from "../../utils/plural";
import { OtherModeLine, SEARCH_MODE_NOUNS } from "./OtherModeLine";
import { SearchFilters } from "./SearchFilters";
import { SearchResultCard } from "./SearchResultCard";
import { SearchResultsSkeleton } from "./SearchSkeleton";
import { resolveSearchView } from "./searchViewState";
import { SEGMENT_CLASS, segmentTone } from "./segmentStyles";
import { useSearchScrollRestore } from "./useSearchScrollRestore";
import { useSearchUrlState } from "./useSearchUrlState";

const MODES: { id: SearchMode; label: string }[] = [
  { id: "items", label: "Przedmioty" },
  { id: "events", label: "Spotkania" },
];

const HINT = "Wpisz co najmniej 2 znaki albo wyczyść pole, żeby przeglądać.";
const PANEL_ID = "szukaj-wyniki";
const tabId = (mode: SearchMode) => `szukaj-tab-${mode}`;

const EMPTY_CARD_CLASS =
  "flex flex-col items-center gap-2.5 rounded-[28px] border-[1.5px] border-dashed border-line-strong bg-paper px-5 py-7 text-center";

const BROWSE_LABEL: Record<SearchMode, string> = {
  items: "Ostatnio dodane przedmioty",
  events: "Najbliższe spotkania",
};

/** „3 przedmioty dla „q””, or for a browse (blank `q`) what is listed. */
function countLabel(mode: SearchMode, count: number, q: string): string {
  if (!q) return count === 0 ? `${BROWSE_LABEL[mode]}: brak` : BROWSE_LABEL[mode];
  return `${count} ${pluralPl(count, ...SEARCH_MODE_NOUNS[mode])} dla „${q}”`;
}

/** The global search over items and meetings (terms, events, groups and
 * organizations). Its state lives in the URL and the loaded pages stay
 * cached, so going back from a result restores them and the scroll. A guest searches everywhere and gets no scope control. */
export function SearchView() {
  const { token, username } = useAuth();
  const guest = !token;
  const { q, mode, scope, filters, setQ, setMode, setScope, setFilters, dateRangeInvalid } = useSearchUrlState(guest);
  const search = useSearch({ q, mode, scope, filters }, guest ? null : username, { enabled: !dateRangeInvalid });
  const term = q.trim();
  const view = resolveSearchView({ ...search, q: term, mode, scope, dateRangeInvalid });

  const { hasNextPage, fetchNextPage, fetchingNextPage, nextPageError } = search;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const canLoadMore = view.kind === "results" && hasNextPage && !fetchingNextPage && nextPageError === null;
  const sentinel = useLoadMoreOnScroll(loadMore, canLoadMore);
  const rememberScroll = useSearchScrollRestore(view.kind === "results" && !view.stale);

  const otherMode: SearchMode = mode === "items" ? "events" : "items";
  const otherModeLine = (count: number, highlighted: boolean) => (
    <OtherModeLine otherMode={otherMode} count={count} q={term} highlighted={highlighted} onSwitch={setMode} />
  );

  let summary: string;
  let body: ReactNode;
  switch (view.kind) {
    case "hint":
      summary = HINT;
      body = null;
      break;
    case "invalid-range":
      summary = "Popraw daty, żeby zobaczyć spotkania.";
      body = null;
      break;
    case "loading":
      summary = "Szukam…";
      body = <SearchResultsSkeleton mode={mode} />;
      break;
    case "error":
      summary = "";
      body = (
        <p role="alert" className="rounded-2xl bg-danger-soft p-4 text-sm text-ink">
          {view.message}
        </p>
      );
      break;
    case "empty-items":
      summary = countLabel(mode, 0, view.q);
      body = (
        <>
          <EmptyItems q={view.q} scope={view.scope} />
          {otherModeLine(view.otherModeCount, true)}
        </>
      );
      break;
    case "empty-meetings":
      summary = countLabel(mode, 0, view.q);
      body = (
        <>
          <div className={EMPTY_CARD_CLASS}>
            <h2 className="font-serif text-[20px] font-extrabold text-ink">Nie znaleźliśmy spotkań</h2>
            <p className="max-w-70 text-[15px] leading-snug text-ink-soft">
              Spróbuj innego słowa albo zmień daty.
            </p>
          </div>
          {otherModeLine(view.otherModeCount, true)}
        </>
      );
      break;
    case "results":
      summary = view.stale ? "Szukam…" : countLabel(mode, view.total, term);
      body = (
        <>
          {view.refreshError && (
            <p role="alert" className="mb-3 text-sm text-danger">
              {view.refreshError}
            </p>
          )}
          <ResultList mode={mode} items={view.items} stale={view.stale} />
          {nextPageError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {nextPageError}
            </p>
          )}
          {hasNextPage && (
            <button
              ref={sentinel}
              type="button"
              onClick={loadMore}
              disabled={fetchingNextPage}
              className="mt-4 flex min-h-11 w-full items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-sm font-extrabold text-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {fetchingNextPage ? "Wczytuję…" : "Pokaż więcej"}
            </button>
          )}
          {otherModeLine(view.otherModeCount, false)}
        </>
      );
      break;
  }

  return (
    <>
      <SearchInput mode={mode} value={q} onChange={setQ} />
      <ModeTabs mode={mode} onSelect={setMode} />
      <SearchFilters
        mode={mode}
        filters={filters}
        dateRangeInvalid={dateRangeInvalid}
        onChange={setFilters}
        scope={guest ? null : scope}
        onScopeChange={setScope}
      />
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(mode)} onClickCapture={rememberScroll}>
        <p aria-live="polite" className="mb-3 text-sm text-ink-soft">
          {summary}
        </p>
        {body}
      </div>
    </>
  );
}

function SearchInput({ mode, value, onChange }: { mode: SearchMode; value: string; onChange: (q: string) => void }) {
  return (
    <div className="mb-3 flex min-h-12.5 min-w-0 items-center gap-2 rounded-full border-2 border-primary bg-paper pr-1.5 pl-4">
      <SearchIcon />
      <label htmlFor="panel-search" className="sr-only">
        {mode === "items" ? "Szukaj przedmiotów" : "Szukaj spotkań"}
      </label>
      <input
        id="panel-search"
        type="search"
        autoFocus
        maxLength={SEARCH_MAX_LENGTH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={mode === "items" ? "Np. wózek, kurtka 104, klocki" : "Np. rytmika, joga, sensoryka"}
        className="h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-soft [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Wyczyść"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-cream text-ink"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

function ModeTabs({ mode, onSelect }: { mode: SearchMode; onSelect: (mode: SearchMode) => void }) {
  const tabRefs = useRef<Partial<Record<SearchMode, HTMLButtonElement | null>>>({});

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = nextIndex(event.key, MODES.findIndex((m) => m.id === mode), MODES.length, "horizontal");
    if (index === null) return;
    event.preventDefault();
    const target = MODES[index].id;
    onSelect(target);
    tabRefs.current[target]?.focus();
  }

  return (
    <div role="tablist" aria-label="Czego szukasz" className="mb-2 grid grid-cols-2 gap-1 rounded-full bg-line p-1">
      {MODES.map((m) => {
        const on = m.id === mode;
        return (
          <button
            key={m.id}
            ref={(element) => {
              tabRefs.current[m.id] = element;
            }}
            type="button"
            role="tab"
            id={tabId(m.id)}
            aria-selected={on}
            aria-controls={PANEL_ID}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(m.id)}
            onKeyDown={handleKeyDown}
            className={`min-h-11 text-[15px] ${SEGMENT_CLASS} ${segmentTone(on)}`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function ResultList({ mode, items, stale }: { mode: SearchMode; items: SearchResult[]; stale: boolean }) {
  return (
    <ul
      aria-busy={stale}
      className={`${mode === "items" ? "grid grid-cols-2 gap-3" : "flex flex-col gap-2.5"} ${stale ? "opacity-60" : ""}`}
    >
      {items.map((result) => (
        <li key={`${result.kind}-${result.id}`}>
          <SearchResultCard result={result} />
        </li>
      ))}
    </ul>
  );
}

function EmptyItems({ q, scope }: { q: string; scope: SearchScope }) {
  return (
    <div className={EMPTY_CARD_CLASS}>
      <span aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-soft text-accent-fg">
        <SearchIcon c="currentColor" />
      </span>
      <h2 className="font-serif text-[20px] font-extrabold text-ink">
        {scope === "mine" ? "Nikt w Twoich grupach tego nie oddaje" : "Nikt tego jeszcze nie oddaje"}
      </h2>
      <p className="max-w-70 text-[15px] leading-snug text-ink-soft">
        Dodaj to do listy „szukam” — dasz znać, czego potrzebujesz.
        {scope === "mine" && " Możesz też szukać wszędzie."}
      </p>
      <Link
        to={q ? `${viewPath("add/hunting")}?name=${encodeURIComponent(q)}` : viewPath("add/hunting")}
        className="mt-1 flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-[15px] font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Dodaj do listy „szukam”
      </Link>
    </div>
  );
}
