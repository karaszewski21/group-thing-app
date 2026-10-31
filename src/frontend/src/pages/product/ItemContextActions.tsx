import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { ItemContextResponse } from "../../api/eventItems";
import type { ExchangeMode } from "../../api/groups";
import type { ItemActionsResponse } from "../../api/itemActions";
import type { OwnerNearestDate } from "../../api/ownerItems";
import { authPath } from "../../auth/authPaths";
import { Avatar } from "../../components/shared/Avatar";
import { ModalSheet } from "../../components/shared/ModalSheet";
import { ToastPill } from "../../components/shared/ToastPill";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY, CARD } from "../../components/shared/uiStyles";
import { useToast } from "../../components/shared/useToast";
import { useOpenAndNavigate } from "../../hooks/useOpenAndNavigate";
import dayjs from "../../utils/dayjs";
import { PICKUP_MODE_LABELS } from "../term/components/termLabels";
import { useAccountGate } from "../term/hooks/useAccountGate";
import { takeContextFrom, useItemTake } from "../term/hooks/useItemTake";
import { SwapProposeDialog } from "../term/modals/SwapProposeDialog";
import { TakeSuccessSheet } from "../term/modals/TakeSuccessSheet";
import type { ItemActionsView } from "./itemActionsViewState";
import { nearestItemContext, organizerItemPath } from "./useItemRoutes";

type Owner = ItemActionsResponse["owner"];

const CTX_LINE = "flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-[13px] font-bold";
const CTX_LIVE = `${CTX_LINE} bg-primary-soft text-primary-fg`;
const CTX_WARN = `${CTX_LINE} bg-danger-soft text-danger`;
const CTX_MUTED = `${CTX_LINE} bg-cream text-ink-soft`;
const HINT = "mt-2 text-[13px] text-ink-soft";
const PRIMARY_ACTION = `${BTN_PRIMARY} ${BTN_LG} mt-2.5 block w-full text-center no-underline`;
const GHOST_ACTION = `${BTN_GHOST} ${BTN_LG} mt-2.5 block w-full text-center text-ink no-underline`;

function dayLabel(startsAt: string): string {
  return dayjs(startsAt).format("ddd D MMM");
}

function whenLabel(startsAt: string): string {
  return dayjs(startsAt).format("ddd D MMM, HH:mm");
}

function ownerItemsPath(owner: Owner): string {
  return `/${owner.slug ?? owner.party_id}/items`;
}

interface ItemContextActionsProps {
  view: ItemActionsView;
  itemId: string;
  itemName: string;
  isLoggedIn: boolean;
  /** Re-reads the actions after a take or proposal. */
  refetch: () => Promise<void>;
}

/** The item page's actions card: one body per `view.kind`. Every action of
 * an anonymous visitor opens the account sheet instead. */
export function ItemContextActions({ view, itemId, itemName, isLoggedIn, refetch }: ItemContextActionsProps) {
  const { toast, showToast } = useToast();
  const takeContext = view.kind === "eligible" || view.kind === "anonymous" ? takeContextFrom(view.context) : null;
  const take = useItemTake({ isLoggedIn, refetch, showToast, context: takeContext });
  const chatGate = useAccountGate(isLoggedIn);
  const chat = useOpenAndNavigate();
  const busy = take.busyItemId === itemId;

  const napisz = (label = "💬 Napisz", primary = false) => (
    <>
      <button
        type="button"
        disabled={chat.busy}
        onClick={chatGate.guard(() => chat.open({ kind: "ITEM", id: itemId }))}
        className={primary ? PRIMARY_ACTION : GHOST_ACTION}
      >
        {label}
      </button>
      {chat.error && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-danger">
          {chat.error}
        </p>
      )}
    </>
  );

  const modeAction = (mode: ExchangeMode) => (
    <button type="button" disabled={busy} onClick={() => take.take(itemId, mode)} className={PRIMARY_ACTION}>
      {PICKUP_MODE_LABELS[mode]}
    </button>
  );

  let body;
  switch (view.kind) {
    case "loading":
      body = (
        <section className={`mt-3 ${CARD}`} aria-busy="true" aria-label="Wczytywanie akcji">
          <div className="h-10 animate-pulse rounded-2xl bg-cream" />
        </section>
      );
      break;
    case "hidden":
      return null;
    case "error":
      body = (
        <section className={`mt-3 ${CARD}`}>
          <div role="alert">
            <p className="text-[13px] font-bold text-danger">Nie udało się wczytać akcji</p>
            <p className={HINT}>{view.message}</p>
          </div>
          <button type="button" onClick={() => void refetch()} className={GHOST_ACTION}>
            Spróbuj ponownie
          </button>
        </section>
      );
      break;
    case "own":
      body = (
        <section className={`mt-3 ${CARD}`}>
          <p className={CTX_MUTED}>
            {view.contextName
              ? `To Twoja rzecz — widoczna dla uczestników „${view.contextName}”`
              : "To Twoja rzecz — inni mogą ją zarezerwować na Twoich terminach i wydarzeniach"}
          </p>
        </section>
      );
      break;
    case "unavailable":
      body = (
        <ActionCard owner={view.owner}>
          {napisz()}
        </ActionCard>
      );
      break;
    case "noContext":
      body = (
        <ActionCard owner={view.owner}>
          {view.nearest ? (
            <NearestHint itemId={itemId} owner={view.owner} nearest={view.nearest} />
          ) : (
            <p className={CTX_MUTED}>Właściciel nie ma teraz zaplanowanych spotkań</p>
          )}
          {napisz("💬 Napisz do właściciela", !view.nearest)}
          <p className={HINT}>Umówcie się na czacie w sprawie tej rzeczy.</p>
        </ActionCard>
      );
      break;
    case "stale":
      body = (
        <ActionCard owner={view.owner}>
          <p className={CTX_WARN}>
            {`⏱ ${view.context.name} (${dayLabel(view.context.starts_at)}) — `}
            {view.context.kind === "EVENT" ? "wydarzenie już się rozpoczęło" : "termin już się odbył"}
          </p>
          {view.nearest && <NearestHint itemId={itemId} owner={view.owner} nearest={view.nearest} />}
          {napisz()}
        </ActionCard>
      );
      break;
    case "anonymous":
      body = (
        <ActionCard owner={view.owner}>
          <p className={CTX_LIVE}>{`📅 ${view.context.name} · ${whenLabel(view.context.starts_at)}`}</p>
          {modeAction(view.mode)}
          {napisz()}
        </ActionCard>
      );
      break;
    case "notSignedUp":
      body = (
        <ActionCard owner={view.owner}>
          <p className={CTX_LIVE}>{`📅 ${view.context.name} · ${whenLabel(view.context.starts_at)}`}</p>
          <p className="mt-3 text-[15px] text-ink">
            {`Żeby zarezerwować tę rzecz, zapisz się na ${contextNoun(view.context)} — tam ją odbierzesz.`}
          </p>
          <Link to={view.context.path} className={PRIMARY_ACTION}>
            {`Zapisz się na ${contextNoun(view.context)} ›`}
          </Link>
          {napisz()}
        </ActionCard>
      );
      break;
    case "eligible":
      body = (
        <ActionCard owner={view.owner}>
          <p className={CTX_LIVE}>{`📅 Odbiór na: ${view.context.name} · ${whenLabel(view.context.starts_at)}`}</p>
          {modeAction(view.mode)}
          {napisz()}
          <p className={HINT}>
            {`Rezerwacja możliwa do startu ${view.context.kind === "EVENT" ? "wydarzenia" : "terminu"}. ` +
              "Właściciel dostanie powiadomienie."}
          </p>
        </ActionCard>
      );
      break;
  }

  return (
    <>
      {body}
      {(take.gateOpen || chatGate.isOpen) && (
        <ItemAuthGateSheet
          onClose={() => {
            take.closeGate();
            chatGate.close();
          }}
        />
      )}
      {take.swap.itemId !== null && (
        <SwapProposeDialog
          availableItems={take.swap.availableItems}
          offeredItemId={take.swap.offeredItemId}
          onOfferedItemChange={take.swap.setOfferedItemId}
          listingProductName={itemName}
          onConfirm={() => take.swap.confirm(itemId)}
          onCancel={take.swap.cancel}
          busy={busy}
        />
      )}
      {take.takeSuccess && (
        <TakeSuccessSheet
          itemId={take.takeSuccess.itemId}
          itemName={take.takeSuccess.itemName}
          context={take.takeSuccess.context}
          onClose={take.closeTakeSuccess}
        />
      )}
      <ToastPill message={toast} />
    </>
  );
}

function contextNoun(context: ItemContextResponse): string {
  return context.kind === "EVENT" ? "wydarzenie" : "termin";
}

/** The card around an action body, followed by the owner row. */
function ActionCard({ owner, children }: { owner: Owner; children: ReactNode }) {
  return (
    <>
      <section className={`mt-3 ${CARD}`} aria-label="Akcje">
        {children}
      </section>
      <section className={`mt-3 flex items-center gap-3 ${CARD}`} aria-label="Właściciel">
        <Avatar name={owner.display_name} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-ink">{owner.display_name}</p>
          <Link to={ownerItemsPath(owner)} className="text-[13px] font-extrabold text-primary-fg no-underline">
            {`Zobacz wszystkie rzeczy (${owner.items_total}) ›`}
          </Link>
        </div>
      </section>
    </>
  );
}

/** "<owner> ma kolejny termin: …" (or "kolejne wydarzenie") with a link to
 * this item in that context. */
function NearestHint({ itemId, owner, nearest }: { itemId: string; owner: Owner; nearest: OwnerNearestDate }) {
  const isEvent = nearest.kind === "EVENT";
  return (
    <>
      <p className={HINT}>
        {`${owner.display_name} ma ${isEvent ? "kolejne wydarzenie" : "kolejny termin"}: `}
        <b>{`${dayLabel(nearest.starts_at)} · ${nearest.name}`}</b>
      </p>
      <Link to={organizerItemPath(owner.slug, itemId, nearestItemContext(nearest))} className={PRIMARY_ACTION}>
        {isEvent ? "Przejdź do wydarzenia ›" : "Przejdź do nowego terminu ›"}
      </Link>
    </>
  );
}

/** The anonymous visitor's account sheet; both links come back to this
 * item, query included. */
function ItemAuthGateSheet({ onClose }: { onClose: () => void }) {
  const location = useLocation();
  const returnTo = location.pathname + location.search;
  return (
    <ModalSheet title="Załóż konto, żeby zarezerwować" onClose={onClose}>
      <p className="mb-4 text-[13px] text-ink-soft">
        Rezerwacje i czat wymagają konta. Wrócisz do tej rzeczy po zalogowaniu.
      </p>
      <Link to={authPath("register", returnTo)} className={`${BTN_PRIMARY} ${BTN_LG} mb-2.5 block w-full text-center no-underline`}>
        Załóż konto
      </Link>
      <Link to={authPath("login", returnTo)} className={`${BTN_GHOST} ${BTN_LG} block w-full text-center text-ink no-underline`}>
        Mam konto — zaloguj
      </Link>
    </ModalSheet>
  );
}
