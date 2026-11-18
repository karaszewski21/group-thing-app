import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { WantMatchResponse, WantResponse, WantSimilarResponse, WantSuggestionResponse } from "../../api/wants";
import { BellIcon } from "../../components/shared/appIcons";
import { FOCUS_CLASS } from "../../components/shared/chipStyles";
import { ConfirmDeleteDialog } from "../../components/shared/ConfirmDeleteDialog";
import { useWantMatches } from "../../hooks/useWantMatches";
import { useWants } from "../../hooks/useWants";
import { Link, useAppNavigate, useAppParams } from "../../routing/navigation";
import { viewPath, wantEditPath } from "../../routing/paths";
import { MatchCard } from "./MatchCard";
import { MatchingStatus } from "./MatchingStatus";
import { SimilarCard } from "./SimilarCard";
import { SuggestionCard } from "./SuggestionCard";
import { resolveWantMatchesView, type ActiveWantView, type ClosedWantView } from "./wantMatchesViewState";
import { WantNotFound } from "./WantNotFound";
import { WantNotificationToggle } from "./WantNotificationToggle";
import { agoLabel, daysLabel, daysUntil, daysUntilRemoval, matchCountLabel, wantSummary } from "./wantText";

const NO_NEW_IDS: ReadonlySet<string> = new Set();
/** With this many days left or fewer, extending is the first action. */
const EXTEND_FIRST_DAYS = 7;
const ACTION_FAILED = "Nie udało się zapisać zmiany. Spróbuj ponownie.";

const BUTTON = `flex min-h-12 items-center justify-center rounded-full px-5 text-[15px] font-extrabold disabled:opacity-60 ${FOCUS_CLASS}`;
const BUTTON_TONE = {
  primary: "bg-primary text-on-primary",
  ghost: "border-[1.5px] border-line bg-paper text-ink",
  danger: "border-[1.5px] border-danger-soft bg-paper text-danger",
} as const;
const HEADER_LINK = `font-extrabold text-primary-fg ${FOCUS_CLASS}`;

/** `/wanted/:id`: one want with the items matching it. Opening the page
 * marks the matches seen once; the items that were new at that moment keep
 * their "nowe" marker for the whole visit, although the refetch after
 * "seen" reports none as new. */
export function WantMatchesView() {
  const { id = "" } = useAppParams();
  const navigate = useAppNavigate();
  const { want, matches, suggestions, similar, slow, loading, notFound, error, refetch, markSeen, markOpened } =
    useWantMatches(id);
  const { update, extend, close, resume } = useWants();
  const view = resolveWantMatchesView({ want, matches, suggestions, similar, slow, loading, notFound, error });

  const [newIds, setNewIds] = useState<ReadonlySet<string> | null>(null);
  if (newIds === null && want !== null) {
    setNewIds(new Set(matches.filter((match) => match.is_new).map((match) => match.id)));
  }

  const loaded = want !== null;
  const seenSent = useRef(false);
  useEffect(() => {
    if (!loaded || seenSent.current) return;
    seenSent.current = true;
    markSeen().catch(() => {});
  }, [loaded, markSeen]);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function run(action: (wantId: string) => Promise<WantResponse>) {
    setBusy(true);
    setActionError(null);
    try {
      await action(id);
    } catch (err) {
      setActionError(err instanceof Error && err.message ? err.message : ACTION_FAILED);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setLeaving(true);
    try {
      await close(id, "WITHDRAWN");
    } catch (err) {
      setLeaving(false);
      throw err;
    }
    navigate(viewPath("wanted"));
  }

  const actions: WantActions = {
    busy,
    error: actionError,
    onExtend: () => void run(extend),
    onFound: () => void run((wantId) => close(wantId, "FULFILLED")),
    onResume: () => void run(resume),
    onWithdraw: () => setConfirmingWithdraw(true),
  };
  const reportOpened = (itemId: string) => {
    markOpened(itemId).catch(() => {});
  };
  const grid = (list: WantMatchResponse[]) => (
    <MatchGrid matches={list} newIds={newIds ?? NO_NEW_IDS} onOpen={reportOpened} />
  );
  const matchList = (list: WantMatchResponse[]) => (
    <>
      <h2 className="mt-1 mb-2.5 text-base font-bold text-ink">{matchCountLabel(list.length)}</h2>
      {grid(list)}
    </>
  );
  const suggestionsSection = (list: WantSuggestionResponse[]) =>
    list.length > 0 && <SuggestionsSection suggestions={list} onOpen={reportOpened} />;
  const similarSection = (list: WantSimilarResponse[]) =>
    list.length > 0 && <SimilarSection similar={list} onOpen={reportOpened} />;
  const toggle = (shown: WantResponse) => (
    <WantNotificationToggle
      checked={shown.notifications_enabled}
      onChange={async (next) => {
        await update(shown.id, { notifications_enabled: next });
      }}
    />
  );
  const withdrawDialog = (shown: WantResponse) =>
    confirmingWithdraw && (
      <ConfirmDeleteDialog
        title="Wycofać poszukiwanie?"
        body={`„${shown.name}” zniknie z listy razem z dopasowaniami. Nie damy już znać o nowych rzeczach.`}
        confirmLabel="Wycofaj"
        busyLabel="Wycofywanie…"
        fallbackError="Nie udało się wycofać poszukiwania. Spróbuj ponownie."
        onConfirm={withdraw}
        onClose={() => setConfirmingWithdraw(false)}
      />
    );

  switch (view.kind) {
    case "loading":
      return (
        <p role="status" className="py-10 text-center text-sm text-ink-soft">
          Wczytywanie…
        </p>
      );
    case "error":
      return (
        <div className="rounded-[22px] border border-line bg-paper p-5">
          <p role="alert" className="text-sm font-semibold text-danger">
            {view.message}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className={`mt-3 ${BUTTON} ${BUTTON_TONE.ghost}`}
          >
            Spróbuj ponownie
          </button>
        </div>
      );
    case "notFound":
      // A withdrawn want is gone before the list opens; no "not found" in between.
      return leaving ? null : <WantNotFound />;
    case "matching":
      return (
        <>
          <WantHeader want={view.want} editable />
          {toggle(view.want)}
          <MatchingStatus />
          {view.matches.length > 0 ? matchList(view.matches) : <SkeletonGrid />}
          {suggestionsSection(view.suggestions)}
          {similarSection(view.similar)}
          <ActiveActions view={view} actions={actions} />
          {withdrawDialog(view.want)}
        </>
      );
    case "matchingSlow":
      return (
        <>
          <WantHeader want={view.want} editable />
          {toggle(view.want)}
          <EmptyCard
            icon="⏳"
            title="Wyniki pojawią się wkrótce"
            text="Szukanie trwa dłużej niż zwykle. Zajrzyj tu za chwilę — damy też znać o nowych rzeczach."
            live
          >
            <button
              type="button"
              onClick={() => void refetch()}
              className={`-my-2 min-h-11 rounded-md px-2 text-[13px] font-extrabold text-primary-fg ${FOCUS_CLASS}`}
            >
              Odśwież teraz
            </button>
          </EmptyCard>
          {view.matches.length > 0 && <div className="mt-3.5">{matchList(view.matches)}</div>}
          {suggestionsSection(view.suggestions)}
          {similarSection(view.similar)}
          <ActiveActions view={view} actions={actions} />
          {withdrawDialog(view.want)}
        </>
      );
    case "active":
      return (
        <>
          <WantHeader want={view.want} editable />
          {toggle(view.want)}
          {matchList(view.matches)}
          {suggestionsSection(view.suggestions)}
          {similarSection(view.similar)}
          <ActiveActions view={view} actions={actions} />
          {withdrawDialog(view.want)}
        </>
      );
    case "activeEmpty":
      return (
        <>
          <WantHeader want={view.want} editable />
          {toggle(view.want)}
          <EmptyCard
            icon={<BellIcon c="currentColor" />}
            title="Jeszcze nic nie pasuje"
            text="Damy znać, gdy ktoś doda pasującą rzecz."
          />
          {suggestionsSection(view.suggestions)}
          {similarSection(view.similar)}
          <ActiveActions view={view} actions={actions} />
          {withdrawDialog(view.want)}
        </>
      );
    case "expired":
    case "fulfilled":
      return (
        <>
          <WantHeader want={view.want} editable={false} />
          <ClosedNotice view={view} actions={actions} />
          {view.matches.length > 0 && matchList(view.matches)}
        </>
      );
  }
}

interface WantActions {
  busy: boolean;
  /** The server's message for the action that failed last. */
  error: string | null;
  onExtend: () => void;
  onFound: () => void;
  onResume: () => void;
  onWithdraw: () => void;
}

function WantHeader({ want, editable }: { want: WantResponse; editable: boolean }) {
  return (
    <header className="mb-3">
      <div className="mb-3.5 flex items-center justify-between gap-2.5 text-sm">
        <Link to={viewPath("wanted")} className={HEADER_LINK}>
          ‹ Szukam
        </Link>
        {editable && (
          <Link to={wantEditPath(want.id)} className={HEADER_LINK}>
            Edytuj
          </Link>
        )}
      </div>
      <h1 className="font-serif text-[26px] leading-[1.15] font-extrabold text-ink">{want.name}</h1>
      <p className="mt-1.5 text-[13px] text-ink-soft">{wantSummary(want, "path")}</p>
      {want.note && <p className="mt-1 text-[13px] break-words text-ink-soft">Notatka: {want.note}</p>}
    </header>
  );
}

function MatchGrid({
  matches,
  newIds,
  onOpen,
}: {
  matches: WantMatchResponse[];
  newIds: ReadonlySet<string>;
  onOpen: (itemId: string) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {matches.map((match) => (
        <MatchCard key={match.id} match={match} isNew={newIds.has(match.id)} onOpen={() => onOpen(match.id)} />
      ))}
    </ul>
  );
}

/** The dashed card of an active want without results to show. A `live`
 * card announces itself, as the matching status does. */
function EmptyCard({
  icon,
  title,
  text,
  live = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  live?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      className="flex flex-col items-center gap-2.5 rounded-[28px] border-[1.5px] border-dashed border-line-strong bg-paper px-5 py-7 text-center"
    >
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent-soft text-[28px] text-accent-fg"
      >
        {icon}
      </span>
      <h2 className="font-serif text-xl font-extrabold text-ink">{title}</h2>
      <p className="text-[15px] text-ink-soft">{text}</p>
      {children}
    </div>
  );
}

const SKELETON_TILES = 4;
const SKELETON_PULSE = "animate-pulse bg-line motion-reduce:animate-none";

/** Placeholder tiles shaped like ItemCard while the first results are on their way. */
function SkeletonGrid() {
  return (
    <ul aria-hidden="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: SKELETON_TILES }, (_, index) => (
        <li key={index} className="flex flex-col rounded-2xl border border-line bg-paper p-2.5">
          <span className={`aspect-square w-full rounded-xl ${SKELETON_PULSE}`} />
          <span className={`mt-2.5 h-2.5 w-4/5 rounded-full ${SKELETON_PULSE}`} />
          <span className={`mt-1.5 h-2.5 w-1/2 rounded-full ${SKELETON_PULSE}`} />
        </li>
      ))}
    </ul>
  );
}

function SuggestionsSection({
  suggestions,
  onOpen,
}: {
  suggestions: WantSuggestionResponse[];
  onOpen: (itemId: string) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-5.5 border-t border-line pt-4">
      <h2 id={headingId} className="mb-2.5 flex items-center gap-2 text-base font-bold text-ink">
        <span aria-hidden="true">💡</span> Może Cię zainteresuje
      </h2>
      <p className="-mt-1 mb-3 text-[13px] text-ink-soft">
        Podobne rzeczy — brakuje im jednego słowa z Twojego „Szukam”.
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {suggestions.map((suggestion) => (
          <SuggestionCard key={suggestion.id} suggestion={suggestion} onOpen={() => onOpen(suggestion.id)} />
        ))}
      </ul>
    </section>
  );
}

function SimilarSection({ similar, onOpen }: { similar: WantSimilarResponse[]; onOpen: (itemId: string) => void }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-5.5 border-t border-line pt-4">
      <h2 id={headingId} className="mb-2.5 flex items-center gap-2 text-base font-bold text-ink">
        <span aria-hidden="true">🔗</span> Powiązane rzeczy
      </h2>
      <p className="-mt-1 mb-3 text-[13px] text-ink-soft">Rzeczy o podobnym znaczeniu — mogą Ci się przydać.</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {similar.map((item) => (
          <SimilarCard key={item.id} similar={item} onOpen={() => onOpen(item.id)} />
        ))}
      </ul>
    </section>
  );
}

function ActionButton({
  tone,
  busy,
  onClick,
  className = "",
  children,
}: {
  tone: keyof typeof BUTTON_TONE;
  busy: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" disabled={busy} onClick={onClick} className={`${BUTTON} ${BUTTON_TONE[tone]} ${className}`}>
      {children}
    </button>
  );
}

function ActionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm font-semibold text-danger">
      {message}
    </p>
  );
}

function ActiveActions({ view, actions }: { view: ActiveWantView; actions: WantActions }) {
  const daysLeft = daysUntil(view.want.expires_at);
  const extendFirst = daysLeft <= EXTEND_FIRST_DAYS;
  const { busy } = actions;
  return (
    <>
      <p className="mt-3.5 mb-2.5 text-[13px] text-ink-soft">Ważne jeszcze {daysLabel(daysLeft)}</p>
      <div className="flex flex-col gap-2.5">
        {extendFirst ? (
          <ActionButton tone="primary" busy={busy} onClick={actions.onExtend}>
            Przedłuż o 90 dni
          </ActionButton>
        ) : (
          <ActionButton tone="primary" busy={busy} onClick={actions.onFound}>
            Znalezione — zamknij
          </ActionButton>
        )}
        <div className="flex gap-2.5">
          {extendFirst ? (
            <ActionButton tone="ghost" busy={busy} onClick={actions.onFound} className="flex-1">
              Znalezione
            </ActionButton>
          ) : (
            <ActionButton tone="ghost" busy={busy} onClick={actions.onExtend} className="flex-1">
              Przedłuż
            </ActionButton>
          )}
          <ActionButton tone="danger" busy={busy} onClick={actions.onWithdraw} className="flex-1">
            Wycofaj
          </ActionButton>
        </div>
        <ActionError message={actions.error} />
      </div>
    </>
  );
}

function ClosedNotice({ view, actions }: { view: ClosedWantView; actions: WantActions }) {
  const closedAt = view.want.closed_at ?? view.want.expires_at;
  const ago = agoLabel(closedAt);
  const lead = view.kind === "expired" ? `To poszukiwanie wygasło ${ago}.` : `Oznaczone jako znalezione ${ago}.`;
  return (
    <div className="mb-3.5 flex flex-col gap-3">
      <p
        className={`rounded-2xl px-3 py-2.5 text-sm font-bold ${view.kind === "expired" ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary-fg"}`}
      >
        {lead} Nie szukamy już nowych rzeczy. Zniknie z listy za {daysLabel(daysUntilRemoval(closedAt))}.
      </p>
      <ActionButton tone="primary" busy={actions.busy} onClick={actions.onResume}>
        {view.kind === "expired" ? "Wznów na 90 dni" : "Szukam znowu"}
      </ActionButton>
      <ActionError message={actions.error} />
    </div>
  );
}
