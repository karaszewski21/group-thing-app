import { useCallback } from "react";
import type { Locality } from "../../api/locations";
import type { SearchFilters, SearchMode } from "../../api/search";
import { useAuth } from "../../auth/AuthContext";
import { RadiusChips } from "../../components/shared/RadiusChips";
import { useNearestLocality } from "../../hooks/useNearestLocality";
import { useSearch } from "../../hooks/useSearch";
import { Link } from "../../routing/navigation";
import { SearchResultCard } from "../search/SearchResultCard";
import { SearchResultsSkeleton } from "../search/SearchSkeleton";
import {
  resolveHomeFeedView,
  resolveHomeSectionView,
  type HomeFeedView,
  type HomeSectionView,
} from "./homeFeedViewState";
import { useHomeRadius } from "./useHomeRadius";
import { useLocationConsent } from "./useLocationConsent";

const PAGE_SIZE: Record<SearchMode, number> = { items: 6, events: 4 };

const SECTION_TITLE = "font-serif text-[22px] leading-tight font-extrabold tracking-tight text-ink";
const SECTION_LINK = "rounded text-sm font-extrabold text-primary-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const LIST_CLASS: Record<SearchMode, string> = {
  items: "grid grid-cols-2 gap-3 sm:grid-cols-3",
  events: "flex flex-col gap-2.5",
};

const NO_FILTERS: SearchFilters = {
  category: null,
  condition: null,
  offer_type: null,
  date_from: null,
  date_to: null,
  locality: null,
  radius: null,
};

const COPY: Record<SearchMode, { recent: string; nearby: string; empty: string }> = {
  items: { recent: "Ostatnio dodane rzeczy", nearby: "Rzeczy w pobliżu", empty: "Nikt jeszcze nic nie dodał." },
  events: {
    recent: "Najbliższe spotkania",
    nearby: "Spotkania w pobliżu",
    empty: "Brak zaplanowanych spotkań i wydarzeń.",
  },
};

/** The home page's two sections, the same for a guest and a logged-in
 * visitor: items (the newest first) and meetings (terms and events, the
 * soonest first), each with „Pokaż więcej”. With the visitor's consent both
 * list what lies around their locality, within the radius picked above them
 * (`useHomeRadius`); without it, or when nothing is near, the newest and
 * soonest from everywhere. */
export function HomeFeed() {
  const { consent, turnOn, turnOff } = useLocationConsent();
  const nearest = useNearestLocality(consent.kind === "located" ? consent.point : null);
  const view = resolveHomeFeedView(consent, nearest);
  const [radius, setRadius] = useHomeRadius();

  return (
    <div className="flex flex-col gap-9">
      {view.kind === "recent" && view.location === "ask" && <LocationPrompt onEnable={turnOn} onDecline={turnOff} />}
      {view.kind === "recent" && view.location === "turnOn" && <TurnOnLine onTurnOn={turnOn} />}
      {view.kind === "nearby" && (
        <RadiusPicker locality={view.locality} radius={radius} onChange={setRadius} onTurnOff={turnOff} />
      )}
      <HomeFeedSection mode="items" feed={view} radius={radius} />
      <HomeFeedSection mode="events" feed={view} radius={radius} />
    </div>
  );
}

const TEXT_BUTTON = `${SECTION_LINK} min-h-11`;

function RadiusPicker({
  locality,
  radius,
  onChange,
  onTurnOff,
}: {
  locality: Locality;
  radius: number | null;
  onChange: (km: number | null) => void;
  onTurnOff: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2.5">
        <p className="text-sm text-ink-soft">
          W pobliżu: <b className="font-extrabold text-ink">{locality.name}</b>
        </p>
        <button type="button" onClick={onTurnOff} className={TEXT_BUTTON}>
          Wyłącz lokalizację
        </button>
      </div>
      <RadiusChips value={radius} onChange={onChange} />
    </div>
  );
}

/** After „Nie teraz” or „Wyłącz”: the newest from everywhere, and the way back. */
function TurnOnLine({ onTurnOn }: { onTurnOn: () => void }) {
  return (
    <div className="-mb-6 flex items-center justify-between gap-2.5">
      <p className="text-sm text-ink-soft">Pokazujemy najnowsze ze wszystkich okolic.</p>
      <button type="button" onClick={onTurnOn} className={TEXT_BUTTON}>
        Pokaż w pobliżu
      </button>
    </div>
  );
}

function LocationPrompt({ onEnable, onDecline }: { onEnable: () => void; onDecline: () => void }) {
  return (
    <section aria-labelledby="home-location" className="rounded-[22px] bg-primary-soft p-4">
      <h2 id="home-location" className="text-base font-extrabold text-ink">
        Pokazać, co jest blisko Ciebie?
      </h2>
      <p className="mt-1 text-sm leading-snug text-ink">
        Włącz lokalizację, a pokażemy rzeczy i spotkania w okolicy. Nie zapisujemy Twojego położenia.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onEnable}
          className="flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Włącz lokalizację
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="flex min-h-11 items-center rounded-full border-[1.5px] border-line bg-paper px-5 text-sm font-extrabold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Nie teraz
        </button>
      </div>
    </section>
  );
}

function searchPath(mode: SearchMode, locality: string | null, radius: number | null): string {
  const params = new URLSearchParams({ mode });
  if (locality) {
    params.set("locality", locality);
    if (radius) params.set("radius", String(radius));
  }
  return `/search?${params}`;
}

function HomeFeedSection({ mode, feed, radius }: { mode: SearchMode; feed: HomeFeedView; radius: number | null }) {
  const { token, username } = useAuth();
  const viewer = token ? username : null;
  const locality = feed.kind === "nearby" ? feed.locality : null;
  const pageSize = PAGE_SIZE[mode];

  const nearby = useSearch(
    { q: "", mode, scope: "all", filters: { ...NO_FILTERS, locality: locality?.id ?? null, radius } },
    viewer,
    { enabled: locality !== null, pageSize },
  );
  const nearbyEmpty = locality !== null && !nearby.loading && !nearby.error && nearby.items.length === 0;
  const recent = useSearch({ q: "", mode, scope: "all", filters: NO_FILTERS }, viewer, {
    enabled: feed.kind === "recent" || nearbyEmpty,
    pageSize,
  });
  const section = resolveHomeSectionView(feed.kind === "pending", locality ? nearby : null, recent);
  const shown = section.kind === "results" && section.source === "nearby" ? nearby : recent;
  const { hasNextPage, fetchingNextPage, nextPageError, fetchNextPage } = shown;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  const copy = COPY[mode];
  const showsNearby = section.kind === "results" ? section.source === "nearby" : locality !== null;
  const headingId = `home-${mode}`;

  return (
    <section aria-labelledby={headingId} aria-busy={section.kind === "loading"}>
      <div className="mb-1 flex items-baseline justify-between gap-2.5">
        <h2 id={headingId} className={SECTION_TITLE}>
          {showsNearby ? copy.nearby : copy.recent}
        </h2>
        <Link to={searchPath(mode, showsNearby ? (locality?.id ?? null) : null, radius)} className={SECTION_LINK}>
          Zobacz wszystkie
        </Link>
      </div>
      {section.kind === "results" && section.fallback && (
        <p className="text-sm text-ink-soft">W pobliżu nic nie znaleźliśmy — pokazujemy najnowsze.</p>
      )}
      <div className="mt-3">
        <SectionBody
          mode={mode}
          section={section}
          more={{ hasNextPage, fetchingNextPage, nextPageError, loadMore }}
        />
      </div>
    </section>
  );
}

interface LoadMore {
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  nextPageError: string | null;
  loadMore: () => void;
}

function SectionBody({ mode, section, more }: { mode: SearchMode; section: HomeSectionView; more: LoadMore }) {
  switch (section.kind) {
    case "loading":
      return <SearchResultsSkeleton mode={mode} />;
    case "error":
      return (
        <p role="alert" className="rounded-2xl bg-danger-soft p-4 text-sm text-ink">
          {section.message}
        </p>
      );
    case "empty":
      return (
        <p className="rounded-[22px] border border-dashed border-line bg-paper px-5 py-6 text-center text-sm text-ink-soft">
          {COPY[mode].empty}
        </p>
      );
    case "results":
      return (
        <>
          <ul className={LIST_CLASS[mode]}>
            {section.items.map((result) => (
              <li key={`${result.kind}-${result.id}`}>
                <SearchResultCard result={result} />
              </li>
            ))}
          </ul>
          {more.nextPageError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {more.nextPageError}
            </p>
          )}
          {more.hasNextPage && (
            <button
              type="button"
              onClick={more.loadMore}
              disabled={more.fetchingNextPage}
              className="mt-3 flex min-h-11 w-full items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-sm font-extrabold text-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {more.fetchingNextPage ? "Wczytuję…" : "Pokaż więcej"}
            </button>
          )}
        </>
      );
  }
}
