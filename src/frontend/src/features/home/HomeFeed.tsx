import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { SearchFilters, SearchMode } from "../../api/search";
import { useAuth } from "../../auth/AuthContext";
import { useNearestLocality } from "../../hooks/useNearestLocality";
import { useSearch } from "../../hooks/useSearch";
import { Link } from "../../routing/navigation";
import { SearchResultCard } from "../search/SearchResultCard";
import { ITEM_GRID_CLASS, MEETING_LIST_CLASS, SearchResultsSkeleton } from "../search/SearchSkeleton";
import {
  resolveHomeFeedView,
  resolveHomeSectionView,
  type HomeFeedView,
  type HomeSectionView,
  type LocationConsent,
} from "./homeFeedViewState";
import { LocationPanel, type LocationPanelState } from "./LocationPanel";
import { useHomeRadius } from "./useHomeRadius";
import { useLocationConsent } from "./useLocationConsent";

const PAGE_SIZE: Record<SearchMode, number> = { items: 8, events: 4 };

const SECTION_TITLE = "font-serif text-[22px] leading-tight font-extrabold tracking-tight text-ink @3xl:text-[30px]";
const SECTION_LINK = "flex-none rounded text-sm font-extrabold whitespace-nowrap text-primary-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const LIST_CLASS: Record<SearchMode, string> = { items: ITEM_GRID_CLASS, events: MEETING_LIST_CLASS };

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

const TOAST_MS = 6000;

/** The location card's state from the consent and the feed view. */
function panelState(consent: LocationConsent, view: HomeFeedView): LocationPanelState {
  if (view.kind === "nearby") return { kind: "nearby", locality: view.locality };
  if (view.kind === "pending") return consent.kind === "checking" ? { kind: "checking" } : { kind: "locating" };
  if (view.location === "ask") return { kind: "ask" };
  return view.location === "turnOn" ? { kind: "off" } : { kind: "unavailable" };
}

/** The home page's location card and two sections, the same for a guest and
 * a logged-in visitor: items (the newest first) and meetings (terms and
 * events, the soonest first), each with „Pokaż więcej”. With the visitor's
 * consent both list what lies around their locality, within the radius
 * picked in the card (`useHomeRadius`); without it, or when nothing is near,
 * the newest and soonest from everywhere. Turning the location off shows a
 * short „Cofnij” notice. `top` places the card (the landing page puts it
 * beside its hero); without it the card leads the feed. The grids follow the
 * feed's own width, so the narrow panel column keeps two columns. */
export function HomeFeed({ top }: { top?: (location: ReactNode) => ReactNode }) {
  const { consent, turnOn, turnOff } = useLocationConsent();
  const nearest = useNearestLocality(consent.kind === "located" ? consent.point : null);
  const view = resolveHomeFeedView(consent, nearest);
  const [radius, setRadius] = useHomeRadius();
  const [offNotice, setOffNotice] = useState(false);

  useEffect(() => {
    if (!offNotice) return;
    const timer = setTimeout(() => setOffNotice(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [offNotice]);

  function switchOff() {
    turnOff();
    setOffNotice(consent.kind === "located");
  }

  function switchOn() {
    setOffNotice(false);
    turnOn();
  }

  const location = (
    <LocationPanel
      state={panelState(consent, view)}
      radius={radius}
      onRadiusChange={setRadius}
      onTurnOn={switchOn}
      onTurnOff={switchOff}
    />
  );

  return (
    <div className="@container flex flex-col gap-9 md:gap-12">
      {top ? top(location) : location}
      <HomeFeedSection mode="items" feed={view} radius={radius} />
      <HomeFeedSection mode="events" feed={view} radius={radius} />
      {offNotice && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-24 z-30 flex items-center justify-between gap-3 rounded-[18px] bg-ink py-2.5 pr-2.5 pl-4.5 text-on-ink shadow-[0_16px_30px_-14px_rgba(20,28,24,0.6)] md:inset-x-auto md:bottom-28 md:left-1/2 md:w-96 md:-translate-x-1/2"
        >
          <span className="text-sm font-bold">Lokalizacja wyłączona</span>
          <button
            type="button"
            onClick={switchOn}
            className="min-h-10 rounded-full bg-on-ink/15 px-3.5 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-ink"
          >
            Cofnij
          </button>
        </div>
      )}
    </div>
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
      {section.kind === "results" && section.fallback ? (
        <p className="text-sm text-ink-soft">W pobliżu nic nie znaleźliśmy — pokazujemy najnowsze.</p>
      ) : (
        showsNearby &&
        locality && (
          <p className="text-sm text-ink-soft">
            {radius === null ? `${locality.name} · tylko ta miejscowość` : `${locality.name} i do ${radius} km dookoła`}
          </p>
        )
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
      return <SearchResultsSkeleton mode={mode} count={PAGE_SIZE[mode]} />;
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
