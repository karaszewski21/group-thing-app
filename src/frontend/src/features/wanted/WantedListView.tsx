import { useId, useState, type ReactNode } from "react";
import type { WantResponse } from "../../api/wants";
import { BellIcon, SearchIcon } from "../../components/shared/appIcons";
import { FOCUS_CLASS } from "../../components/shared/chipStyles";
import { useWants } from "../../hooks/useWants";
import { Link } from "../../routing/navigation";
import { viewPath, wantPath } from "../../routing/paths";
import { PanelSectionSkeleton } from "../panel/PanelRouteStates";
import {
  agoLabel,
  daysLabel,
  daysUntil,
  daysUntilRemoval,
  matchCountLabel,
  newCountLabel,
  wantSummary,
} from "./wantText";
import { resolveWantedListView } from "./wantedListViewState";

/** "Przedłuż" appears on a want with this many days left, or fewer. */
const EXTEND_OFFER_DAYS = 7;

const PRIMARY_LINK = `flex items-center justify-center rounded-full bg-primary font-extrabold text-on-primary ${FOCUS_CLASS}`;
const GHOST_BUTTON = `flex min-h-10 flex-none items-center justify-center rounded-full border-[1.5px] border-line bg-paper px-3.5 text-sm font-extrabold text-ink hover:bg-cream disabled:opacity-60 ${FOCUS_CLASS}`;
const PILL = "flex-none rounded-full px-2.5 py-0.5 text-xs font-extrabold";
const META = "text-[13px] text-ink-soft";
const ALERT = "text-[12.5px] font-semibold text-danger";

type WantAction = (id: string) => Promise<unknown>;

/** "Szukam" (/wanted): the caller's wants, the active ones with their match
 * counts, the expired and fulfilled ones until the server removes them.
 * Adding and editing have their own pages. */
export function WantedListView() {
  const { data, loading, error, refetch, extend, resume } = useWants();
  const view = resolveWantedListView({ loading, error, wants: data });

  switch (view.kind) {
    case "loading":
      return (
        <WantedListFrame>
          <PanelSectionSkeleton />
        </WantedListFrame>
      );
    case "error":
      return (
        <WantedListFrame>
          <p role="alert" className={ALERT}>
            {view.message}
          </p>
          <button type="button" onClick={() => void refetch()} className={`${GHOST_BUTTON} mt-3`}>
            Spróbuj ponownie
          </button>
        </WantedListFrame>
      );
    case "empty":
      return (
        <WantedListFrame>
          <EmptyWants />
        </WantedListFrame>
      );
    case "list":
      return (
        <WantedListFrame withAddLink>
          {view.refreshError && (
            <p role="alert" className={`${ALERT} mb-3`}>
              {view.refreshError}
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {view.wants.map((want) =>
              want.status === "ACTIVE" ? (
                <ActiveWantCard key={want.id} want={want} extend={extend} />
              ) : (
                <ClosedWantCard key={want.id} want={want} resume={resume} />
              ),
            )}
          </ul>
        </WantedListFrame>
      );
  }
}

function WantedListFrame({ withAddLink = false, children }: { withAddLink?: boolean; children: ReactNode }) {
  return (
    <>
      <Link
        to={viewPath("account")}
        className={`mb-3.5 inline-block rounded-md text-sm font-bold text-primary-fg ${FOCUS_CLASS}`}
      >
        ‹ Konto
      </Link>
      <div className="mb-2 flex items-center justify-between gap-2.5">
        <h1 className="font-serif text-[26px] leading-tight font-extrabold tracking-tight text-ink">Szukam</h1>
        {withAddLink && (
          <Link to={viewPath("add/wanted")} className={`${PRIMARY_LINK} min-h-10 flex-none px-3.5 text-sm`}>
            + Dodaj
          </Link>
        )}
      </div>
      <p className="mb-3.5 text-[15px] leading-snug text-ink-soft">
        Zapisz, czego potrzebujesz. Damy znać, gdy ktoś doda pasującą rzecz.
      </p>
      {children}
    </>
  );
}

function EmptyWants() {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-[28px] border-[1.5px] border-dashed border-line-strong bg-paper px-5 py-7 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-soft text-accent-fg"
      >
        <SearchIcon c="currentColor" />
      </span>
      <p className="font-serif text-[22px] font-extrabold text-ink">Czego potrzebujesz?</p>
      <p className="max-w-70 text-[15px] leading-snug text-ink-soft">
        Dodaj rzecz, której szukasz, np. fotelik albo kurtkę na zimę.
      </p>
      <Link to={viewPath("add/wanted")} className={`${PRIMARY_LINK} mt-1.5 min-h-12 px-5 text-[15px]`}>
        + Dodaj poszukiwanie
      </Link>
    </div>
  );
}

/** One card action: busy while it runs, and the server's message when it fails. */
function useWantAction(action: WantAction, wantId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await action(wantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run };
}

function WantCardHeader({ want, summary, pill }: { want: WantResponse; summary: string; pill?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2.5">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-bold wrap-break-word text-ink">
          <Link to={wantPath(want.id)} className={`rounded-md ${FOCUS_CLASS}`}>
            {want.name}
          </Link>
        </h2>
        <p className={META}>{summary}</p>
      </div>
      {pill}
    </div>
  );
}

function ActiveWantCard({ want, extend }: { want: WantResponse; extend: WantAction }) {
  const { busy, error, run } = useWantAction(extend, want.id);
  const errorId = useId();
  const daysLeft = daysUntil(want.expires_at);

  return (
    <li className="flex flex-col gap-2.5 rounded-[22px] border border-line bg-paper p-3.5">
      <WantCardHeader
        want={want}
        summary={wantSummary(want, "name")}
        pill={
          want.new_match_count > 0 && (
            <span className={`${PILL} bg-primary text-on-primary`}>{newCountLabel(want.new_match_count)}</span>
          )
        }
      />
      {want.match_count > 0 ? (
        <p className="rounded-2xl bg-primary-soft px-3 py-2.5 text-sm font-extrabold text-primary-fg">
          {matchCountLabel(want.match_count)}
        </p>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl bg-cream px-3 py-2.5 text-sm text-ink">
          <BellIcon c="currentColor" />
          <p>Jeszcze nic · powiadomimy Cię</p>
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-x-1.5 ${META}`}>
        <p>Ważne jeszcze {daysLabel(daysLeft)}</p>
        {daysLeft <= EXTEND_OFFER_DAYS && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run()}
              aria-label={`Przedłuż: ${want.name}`}
              aria-describedby={error ? errorId : undefined}
              className={`-my-2 rounded-md py-2 text-sm font-extrabold text-primary-fg disabled:opacity-60 ${FOCUS_CLASS}`}
            >
              Przedłuż
            </button>
          </>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className={ALERT}>
          {error}
        </p>
      )}
    </li>
  );
}

/** An expired or fulfilled want; both come back through resume. */
function ClosedWantCard({ want, resume }: { want: WantResponse; resume: WantAction }) {
  const { busy, error, run } = useWantAction(resume, want.id);
  const errorId = useId();
  const fulfilled = want.status === "FULFILLED";
  const closedAt = want.closed_at ?? want.expires_at;
  const actionLabel = fulfilled ? "Szukam znowu" : "Wznów";

  return (
    <li className="flex flex-col gap-2.5 rounded-[22px] border border-line bg-paper p-3.5">
      <WantCardHeader
        want={want}
        summary={`${fulfilled ? "Znalezione" : "Wygasło"} ${agoLabel(closedAt)}`}
        pill={
          fulfilled ? (
            <span className={`${PILL} bg-primary-soft text-primary-fg`}>Znalezione</span>
          ) : (
            <span className={`${PILL} bg-danger-soft text-danger`}>Wygasło</span>
          )
        }
      />
      <div className="flex items-center justify-between gap-2.5">
        <p className={META}>Zniknie z listy za {daysLabel(daysUntilRemoval(closedAt))}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          aria-label={`${actionLabel}: ${want.name}`}
          aria-describedby={error ? errorId : undefined}
          className={GHOST_BUTTON}
        >
          {actionLabel}
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className={ALERT}>
          {error}
        </p>
      )}
    </li>
  );
}
