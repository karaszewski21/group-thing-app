import { useId, useState, type ReactNode } from "react";
import { Link } from "../../../routing/navigation";
import type { ItemActionsResponse, ItemContextOptionResponse, ItemLocationResponse } from "../../../api/itemActions";
import { Avatar } from "../../../components/shared/Avatar";
import { PlaceMapEmbed } from "../../../components/shared/PlaceMapEmbed";
import { ToastPill } from "../../../components/shared/ToastPill";
import { BTN_GHOST, BTN_LG, BTN_PRIMARY, CARD } from "../../../components/shared/uiStyles";
import { useToast } from "../../../components/shared/useToast";
import { useOpenAndNavigate } from "../../../hooks/useOpenAndNavigate";
import { buildMapsUrl } from "../../../lib/googleMaps";
import { ownerPagePath, viewPath } from "../../../routing/paths";
import dayjs from "../../../utils/dayjs";
import { localityDetail, localityMapsQuery } from "../../../utils/locationLabel";
import { useAccountGate } from "../../auth/useAccountGate";
import { AuthSheet } from "../../auth/AuthSheet";
import { ChooseContextSheet, ContextPlaceLine } from "./ChooseContextSheet";
import type { ItemActionsView } from "./itemActionsViewState";
import { PartyReservationActions } from "./PartyReservationActions";
import { PersonalPickupSheet } from "./PersonalPickupSheet";
import { SwapProposeDialog } from "./SwapProposeDialog";
import { TakeSuccessSheet } from "./TakeSuccessSheet";
import { itemEditPath } from "./useItemRoutes";
import { useItemTake } from "./useItemTake";

type Owner = ItemActionsResponse["owner"];
type ChooseView = Extract<ItemActionsView, { kind: "choose" }>;

const HEADING = "text-[15px] font-extrabold text-ink";
const HINT = "mt-2 text-[13px] text-ink-soft";
const BLOCKABLE = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const PRIMARY_ACTION = `${BTN_PRIMARY} ${BTN_LG} ${BLOCKABLE} mt-2.5 block w-full text-center no-underline`;
const OUTLINE_ACTION = `${BTN_GHOST} ${BTN_LG} ${BLOCKABLE} mt-2.5 block w-full border-primary text-center text-primary-fg no-underline`;
const GHOST_ACTION = `${BTN_GHOST} ${BTN_LG} mt-2.5 block w-full text-center text-ink no-underline`;
const CHAT_LABEL = "💬 Napisz o przedmiocie";
const ITEM_ACCOUNT_MESSAGE = "Rezerwacja i czat wymagają konta. Zaloguj się albo załóż konto — zostaniesz przy tej rzeczy.";

function ownerItemsPath(owner: Owner): string {
  return `/${owner.slug ?? owner.party_id}/items`;
}

interface ItemContextActionsProps {
  view: ItemActionsView;
  itemId: string;
  itemName: string;
  isLoggedIn: boolean;
  /** The other party's label from the item status, for the party hints. */
  counterpartyName: string | null;
  /** Re-reads the actions after a reservation or a settlement. */
  refetch: () => Promise<void>;
}

/** The item page's reservation surface: one body per `view.kind`, plus the
 * sheets of the two reserve paths. A personal reservation opens the ITEM
 * chat; when that fails the reservation still shows and the chat error
 * appears under the chat button. */
export function ItemContextActions({
  view,
  itemId,
  itemName,
  isLoggedIn,
  counterpartyName,
  refetch,
}: ItemContextActionsProps) {
  const { toast, showToast } = useToast();
  const chat = useOpenAndNavigate();
  const take = useItemTake({
    isLoggedIn,
    refetch,
    showToast,
    onReserved: (target) => {
      if (target.kind === "PERSONAL") void chat.open({ kind: "ITEM", id: itemId });
    },
  });
  const accountGate = useAccountGate(isLoggedIn);
  const [sheet, setSheet] = useState<"personal" | "context" | null>(null);
  const busy = take.busyItemId === itemId;
  const { takeSuccess } = take;

  const chatButton = (
    <>
      <button
        type="button"
        disabled={chat.busy}
        onClick={accountGate.guard(() => chat.open({ kind: "ITEM", id: itemId }))}
        className={GHOST_ACTION}
      >
        {CHAT_LABEL}
      </button>
      {chat.error && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-danger">
          {chat.error}
        </p>
      )}
    </>
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
        <>
          <OwnLocationCard location={view.location} itemId={itemId} />
          <ContextList contexts={view.contexts} subtitle="Terminy i wydarzenia, na których bywasz" />
          {view.mode === null ? (
            <p className="mt-3 rounded-2xl bg-accent-soft p-3 text-[13px] text-ink">
              Ta rzecz nie jest wystawiona — ustaw „Oddam” albo „Zamienię” w{" "}
              <Link
                to={viewPath("items")}
                className="font-bold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                „Moje rzeczy”
              </Link>
              , żeby inni mogli ją zarezerwować.
            </p>
          ) : (
            <p className="mt-3 rounded-2xl bg-accent-soft p-3 text-[13px] text-ink">
              To Twoja rzecz. Inni mogą ją zarezerwować osobiście albo na Twoich terminach.
              {view.visibility === "PRIVATE" && " Prywatna — widzą ją tylko osoby z Twoich prywatnych grup."}
            </p>
          )}
          {view.partyReservation && (
            <section className={`mt-3 ${CARD}`} aria-label="Rezerwacja">
              <PartyReservationActions
                party={view.partyReservation}
                ownerName="Ty"
                counterpartyName={counterpartyName}
                refetch={refetch}
              />
            </section>
          )}
        </>
      );
      break;
    case "anonymous":
      body = (
        <>
          {view.location && <LocationCard location={view.location} />}
          <ContextList
            contexts={view.contexts}
            subtitle={`Terminy i wydarzenia, na których bywa ${view.owner.display_name}`}
          />
          <ActionCard owner={view.owner} title="Jak chcesz odebrać?">
            <button type="button" onClick={() => accountGate.open()} className={PRIMARY_ACTION}>
              Odbiorę osobiście
            </button>
            <button type="button" onClick={() => accountGate.open()} className={OUTLINE_ACTION}>
              Wybieram termin
            </button>
            {chatButton}
          </ActionCard>
        </>
      );
      break;
    case "reserved":
      body = (
        <>
          {view.location && <LocationCard location={view.location} />}
          <ActionCard owner={view.owner}>
            {view.partyReservation ? (
              <PartyReservationActions
                party={view.partyReservation}
                ownerName={view.owner.display_name}
                counterpartyName={counterpartyName}
                refetch={refetch}
              />
            ) : (
              <TakenActions />
            )}
            {chatButton}
          </ActionCard>
        </>
      );
      break;
    case "unavailable":
      body = (
        <>
          {view.location && <LocationCard location={view.location} />}
          <ActionCard owner={view.owner}>{chatButton}</ActionCard>
        </>
      );
      break;
    case "choose":
      body = (
        <>
          {view.location && (
            <LocationCard
              location={view.location}
              note={view.personalPickup ? "Odbiór osobisty dostępny." : undefined}
            />
          )}
          <ContextList
            contexts={view.contexts}
            subtitle={`Terminy i wydarzenia, na których bywa ${view.owner.display_name}`}
          />
          <ActionCard owner={view.owner} title="Jak chcesz odebrać?">
            <ChooseActions
              view={view}
              busy={busy}
              onPersonal={() => setSheet("personal")}
              onContext={() => setSheet("context")}
            />
            {chatButton}
          </ActionCard>
        </>
      );
      break;
  }

  const choose = view.kind === "choose" ? view : null;
  return (
    <>
      {body}
      {choose && sheet === "personal" && choose.location && (
        <PersonalPickupSheet
          ownerName={choose.owner.display_name}
          itemName={itemName}
          locationName={choose.location.locality.name}
          mode={choose.mode}
          onClose={() => setSheet(null)}
          onConfirm={() => {
            setSheet(null);
            take.take(itemId, choose.mode, { kind: "PERSONAL" });
          }}
        />
      )}
      {choose && sheet === "context" && choose.eligibleContexts.length > 0 && (
        <ChooseContextSheet
          ownerName={choose.owner.display_name}
          mode={choose.mode}
          contexts={choose.eligibleContexts}
          onClose={() => setSheet(null)}
          onConfirm={(context: ItemContextOptionResponse) => {
            setSheet(null);
            take.take(itemId, choose.mode, context);
          }}
        />
      )}
      {(take.gateOpen || accountGate.isOpen) && (
        <AuthSheet
          message={ITEM_ACCOUNT_MESSAGE}
          onClose={() => {
            take.closeGate();
            accountGate.close();
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
      {takeSuccess && (
        <TakeSuccessSheet
          itemId={takeSuccess.itemId}
          itemName={takeSuccess.itemName}
          target={takeSuccess.target}
          onClose={take.closeTakeSuccess}
        />
      )}
      <ToastPill message={toast} />
    </>
  );
}

/** "Odbiorę osobiście" and "Wybieram termin". A blocked action stays
 * focusable (`aria-disabled`) so its hint reaches keyboard and screen-reader
 * users; only a running reservation disables it natively. */
function ChooseActions({
  view,
  busy,
  onPersonal,
  onContext,
}: {
  view: ChooseView;
  busy: boolean;
  onPersonal: () => void;
  onContext: () => void;
}) {
  const personalHintId = useId();
  const contextHintId = useId();
  const personalHint =
    view.location === null
      ? `${view.owner.display_name} nie ustawił(a) jeszcze miejsca odbioru — napisz na czacie, żeby się umówić.`
      : !view.personalPickup
        ? "Odbiór osobisty nie jest dostępny dla tej rzeczy."
        : null;
  const personalBlocked = personalHint !== null;
  const contextBlocked = view.eligibleContexts.length === 0;
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-disabled={!busy && personalBlocked ? true : undefined}
        aria-describedby={personalBlocked ? personalHintId : undefined}
        onClick={() => {
          if (!personalBlocked) onPersonal();
        }}
        className={PRIMARY_ACTION}
      >
        Odbiorę osobiście
      </button>
      {personalBlocked && (
        <p id={personalHintId} className={HINT}>
          {personalHint}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        aria-disabled={!busy && contextBlocked ? true : undefined}
        aria-describedby={contextBlocked ? contextHintId : undefined}
        onClick={() => {
          if (!contextBlocked) onContext();
        }}
        className={OUTLINE_ACTION}
      >
        Wybieram termin
      </button>
      {contextBlocked && (
        <p id={contextHintId} className={HINT}>
          Nie macie wspólnego terminu ani wydarzenia, na które jesteś zapisany(-a).
        </p>
      )}
    </>
  );
}

/** Both reserve actions for a viewer outside someone else's reservation:
 * focusable but blocked (`aria-disabled`), described by why. */
function TakenActions() {
  const hintId = useId();
  return (
    <>
      <button type="button" aria-disabled="true" aria-describedby={hintId} className={PRIMARY_ACTION}>
        Odbiorę osobiście
      </button>
      <button type="button" aria-disabled="true" aria-describedby={hintId} className={OUTLINE_ACTION}>
        Wybieram termin
      </button>
      <p id={hintId} className={HINT}>
        Ktoś już zarezerwował tę rzecz. Jeśli rezerwacja zostanie anulowana, znów będzie dostępna.
      </p>
    </>
  );
}

const LOCATION_LINK = "text-[13px] font-bold text-primary-fg underline underline-offset-2";

/** "Lokalizacja przedmiotu": the card every viewer sees above the actions. */
function LocationSection({ children }: { children: ReactNode }) {
  const headingId = useId();
  return (
    <section className={`mt-3 ${CARD}`} aria-labelledby={headingId}>
      <h3 id={headingId} className="text-xs font-bold text-ink-soft">
        Lokalizacja przedmiotu
      </h3>
      {children}
    </section>
  );
}

const LOCALITY_MAP_ZOOM = 12;
const ADDRESS_MAP_ZOOM = 16;

/** 📍 + the bold locality, its gmina/powiat/voivodeship line and, unless
 * the place is gone, a Maps search on the locality (never the address) and
 * a map pinning it. `address` (the owner's own view only) pins the address. */
function LocalityLine({
  location,
  deleted,
  address = null,
}: {
  location: ItemLocationResponse;
  deleted: boolean;
  address?: string | null;
}) {
  const { locality } = location;
  return (
    <>
      <div className="mt-1.5 flex items-start gap-2.5">
        <span aria-hidden="true">📍</span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold wrap-break-word text-ink">
            {deleted ? `${locality.name} (usunięte)` : locality.name}
          </p>
          <p className="text-[13px] wrap-break-word text-ink-soft">{localityDetail(locality)}</p>
          {!deleted && (
            <a
              href={buildMapsUrl({ query: localityMapsQuery(locality) })}
              target="_blank"
              rel="noopener noreferrer"
              className={LOCATION_LINK}
            >
              Otwórz w Mapach <span className="sr-only">(nowa karta)</span>
            </a>
          )}
        </div>
      </div>
      {!deleted && (
        <PlaceMapEmbed
          query={address ? `${address}, ${localityMapsQuery(locality)}` : localityMapsQuery(locality)}
          zoom={address ? ADDRESS_MAP_ZOOM : LOCALITY_MAP_ZOOM}
          title={`Mapa: ${locality.name}`}
        />
      )}
    </>
  );
}

/** The item's place as anyone but the owner sees it: the locality only. */
function LocationCard({ location, note }: { location: ItemLocationResponse; note?: string }) {
  return (
    <LocationSection>
      <LocalityLine location={location} deleted={false} />
      {note && <p className={HINT}>{note}</p>}
    </LocationSection>
  );
}

/** The owner's view: the address only they see and a way to change the
 * place; without a live place, personal pickup is off until they set one. */
function OwnLocationCard({ location, itemId }: { location: ItemLocationResponse | null; itemId: string }) {
  const editLink = (label: string) => (
    <Link to={itemEditPath(itemId)} className={LOCATION_LINK}>
      {label}
    </Link>
  );
  const usable = location !== null && location.deleted_at === null;
  return (
    <LocationSection>
      {location && (
        <LocalityLine location={location} deleted={!usable} address={usable ? location.formatted_address : null} />
      )}
      {usable && location.formatted_address && (
        <p className="mt-2.5 rounded-xl bg-cream px-3 py-2 text-[13px] wrap-break-word text-ink">
          <em className="block text-[11px] font-bold text-ink-soft not-italic">Widoczne tylko dla Ciebie</em>
          {location.formatted_address}
        </p>
      )}
      <p className={HINT}>
        {usable ? editLink("Zmień lokalizację") : <>Odbiór osobisty niedostępny — {editLink("ustaw lokalizację")}.</>}
      </p>
    </LocationSection>
  );
}

/** "Gdzie jeszcze można odebrać": the owner's upcoming terms and events,
 * read-only. Nothing when there are none. */
function ContextList({ contexts, subtitle }: { contexts: ItemContextOptionResponse[]; subtitle: string }) {
  const headingId = useId();
  if (contexts.length === 0) return null;
  return (
    <section className={`mt-3 ${CARD}`} aria-labelledby={headingId}>
      <h3 id={headingId} className={HEADING}>
        Gdzie jeszcze można odebrać
      </h3>
      <p className="mt-1 text-[13px] text-ink-soft">{subtitle}</p>
      <ul className="mt-1.5">
        {contexts.map((context) => (
          <li
            key={`${context.kind}-${context.id}`}
            className="flex items-start gap-3 border-t border-line py-2.5 first:border-t-0"
          >
            <span className="w-11 flex-none rounded-xl bg-cream py-1 text-center text-[11px] leading-tight font-extrabold text-ink uppercase">
              {dayjs(context.starts_at).format("ddd")}
              <br />
              {dayjs(context.starts_at).format("D MMM")}
            </span>
            <span className="min-w-0">
              <span className="text-[13px] font-extrabold wrap-break-word text-ink">{context.name}</span>
              {context.kind === "EVENT" && (
                <>
                  {" "}
                  <span className="rounded-full bg-teal-soft px-2 py-0.5 text-[11px] font-bold text-ink">
                    wydarzenie
                  </span>
                </>
              )}
              <ContextPlaceLine context={context} className="block text-xs text-ink-soft" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The card around an action body (titled when `title` is given), followed by the owner row. */
function ActionCard({ owner, title, children }: { owner: Owner; title?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <>
      <section
        className={`mt-3 ${CARD}`}
        aria-labelledby={title ? headingId : undefined}
        aria-label={title ? undefined : "Akcje"}
      >
        {title && (
          <h3 id={headingId} className={HEADING}>
            {title}
          </h3>
        )}
        {children}
      </section>
      <OwnerRow owner={owner} />
    </>
  );
}

function OwnerRow({ owner }: { owner: Owner }) {
  return (
    <section className={`mt-3 flex items-center gap-3 ${CARD}`} aria-label="Właściciel">
      <Avatar name={owner.display_name} size="md" />
      <div className="min-w-0">
        <Link
          to={ownerPagePath(owner)}
          className="block truncate text-sm font-extrabold text-ink no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {owner.display_name}
        </Link>
        <Link to={ownerItemsPath(owner)} className="text-[13px] font-extrabold text-primary-fg no-underline">
          {`Zobacz wszystkie rzeczy (${owner.items_total}) ›`}
        </Link>
      </div>
    </section>
  );
}
