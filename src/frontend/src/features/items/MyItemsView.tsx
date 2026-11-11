import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "../../routing/navigation";
import {
  ACTIVE_LOCK_BALANCE_STATUSES,
  type BalanceStatus,
  type MyInventoryItemResponse,
  type MyItemsModeFilter,
} from "../../api/inventories";
import { useLoadMoreOnScroll } from "../../hooks/useLoadMoreOnScroll";
import { useMyItemsPage } from "../../hooks/useMyItemsPage";
import { serverMessageOr } from "../../api/problem";
import { cancelTransaction, confirmTransaction, getReservation } from "../../api/reservations";
import {
  acceptSwapProposal,
  getSwapProposalsForItem,
  isPersonalSwapAccept,
  PERSONAL_SWAP_ACCEPTED_MESSAGE,
  type SwapProposalOfferResponse,
} from "../../api/termItemListings";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { BoxIcon, CloseIcon, PencilIcon, SearchIcon, TrashIcon } from "../../components/shared/appIcons";
import {
  capitalize,
  ITEM_MODE_TO_RESERVATION_TYPE,
  ITEM_MODES,
  RESERVATION_TYPE_TO_ITEM_MODE,
  type ItemMode,
} from "../../utils/appHelpers";
import { useAppData } from "../panel/appDataStore";
import { SafeImage } from "../product/ItemGallery";
import { itemEditPath, itemPagePath } from "../product/useItemRoutes";
import { SwapAcceptSuccessSheet, type AcceptedSwap } from "./SwapAcceptSuccessSheet";
import { VisibilityToggle } from "./VisibilityToggle";

const PRIVATE_HINT = "Prywatna: widoczna tylko w Twoich prywatnych grupach.";
const NO_MODE_HINT = "Ustaw tryb, żeby wybrać widoczność.";

/** Soft tile + readable text per item mode, matching the exchange tones. */
const MODE_TONE: Record<ItemMode, string> = {
  "oddam": "bg-primary-soft text-primary-fg",
  "zamienię": "bg-accent-soft text-accent-fg",
};

const ICON_BUTTON =
  "flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-line text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** Passive "moje rzeczy" status badge label for an item's current
 * `BalanceStatus` — `null` means no badge (the item is free). Only the two
 * "something is in flight, no new action is possible right now" statuses
 * get one: `RESERVED` (a reservation exists but the holder hasn't
 * confirmed yet — including the proposer's own auto-locked leg of a SWAP
 * proposal still awaiting the listing owner's accept/reject) and
 * `IN_TRANSIT` (already confirmed and moving — including an accepted
 * swap). Any other status is settled, not "pending", so it renders no
 * badge here. This view is purely informational per
 * spec.md Requirement 12-13 — no action button is ever added next to it. */
interface ReservationTermInfo {
  hasEnded: boolean;
  isGift: boolean;
  isUnpairedSwap: boolean;
}

function lockBadgeLabel(status: BalanceStatus | undefined): string | null {
  if (status === "RESERVED") return "czeka na potwierdzenie";
  if (status === "IN_TRANSIT") return "zablokowane";
  return null;
}

/** Passive status pill next to the mode toggles. Text-carried label, not
 * color-only, per `standards/frontend/accessibility.md` — the dot is
 * `aria-hidden` decoration, never the sole signal. */
function StatusPill({ label }: { label: string }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-ink-soft"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink-soft" />
      {label}
    </span>
  );
}

export function MyItemsView() {
  const {
    items: panelItems,
    itemModes,
    itemError,
    ownSlug,
    setItemMode,
    setItemVisibility,
    handleDeleteItem,
    load,
  } = useAppData();

  const [filter, setFilter] = useState<ItemMode | null>(null);
  const [query, setQuery] = useState("");
  const paged = useMyItemsPage(
    filter ? (ITEM_MODE_TO_RESERVATION_TYPE[filter] as MyItemsModeFilter) : null,
    query,
  );
  const { counts, hasNextPage, fetchingNextPage, nextPageError, fetchNextPage } = paged;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const sentinel = useLoadMoreOnScroll(
    loadMore,
    !paged.loading && hasNextPage && !fetchingNextPage && nextPageError === null,
  );

  // The page decides which items show and in what order; the panel's copy
  // of an item, updated at once by every save and photo poll, wins.
  const panelById = useMemo(() => new Map(panelItems.map((it) => [it.id, it])), [panelItems]);
  const items = useMemo(
    () => paged.items.map((it) => panelById.get(it.id) ?? it),
    [paged.items, panelById],
  );
  const modeOf = (it: MyInventoryItemResponse): ItemMode | null =>
    panelById.has(it.id)
      ? (itemModes[it.id] ?? null)
      : ((it.listing_mode && RESERVATION_TYPE_TO_ITEM_MODE[it.listing_mode]) ?? null);

  // Each item carries its lock (`balance_status`) and active reservation.
  const itemsById = new Map(items.map((it) => [it.id, it]));
  const lockedReservationIdsKey = Array.from(
    new Set(
      items
        .filter((it) => ACTIVE_LOCK_BALANCE_STATUSES.includes(it.balance_status))
        .map((it) => it.reservation_id)
        .filter((id): id is string => id !== null),
    ),
  ).join(",");

  // Bug #4c: whether the active reservation's Term has already occurred,
  // keyed by `reservationId` — mirrors `TermPage.tsx`'s
  // `currentTermHasOccurred()`. The date comes with the reservation itself
  // (`term_occurs_on`), which still resolves when the Term's group is
  // soft-deleted, unlike `GET /terms/{id}`. Settled per reservation so one
  // failing fetch never hides the buttons of the other locked items.
  // A personal reservation (no term or event) counts as ended right away.
  // `isGift`: on their own gift the owner is the giver, who may only cancel —
  // the recipient confirms receipt. `isUnpairedSwap`: a SWAP leg still
  // waiting for its proposal's accept is released only by a reject.
  const [reservationTermInfo, setReservationTermInfo] = useState<Record<string, ReservationTermInfo>>({});
  useEffect(() => {
    const lockedReservationIds = lockedReservationIdsKey === "" ? [] : lockedReservationIdsKey.split(",");
    if (lockedReservationIds.length === 0) {
      setReservationTermInfo({});
      return;
    }
    let cancelled = false;
    void Promise.allSettled(lockedReservationIds.map((id) => getReservation(id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, ReservationTermInfo> = {};
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { id, term_occurs_on, reservation_type, personal_pickup, paired_reservation_id } = result.value;
        next[id] = {
          hasEnded:
            personal_pickup || (term_occurs_on != null && new Date(term_occurs_on).getTime() <= Date.now()),
          isGift: reservation_type === "GIFT",
          isUnpairedSwap: reservation_type === "SWAP" && paired_reservation_id === null,
        };
      }
      setReservationTermInfo(next);
    });
    return () => {
      cancelled = true;
    };
  }, [lockedReservationIdsKey]);

  const [actionBusyItemId, setActionBusyItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Pending swap offers against each of the caller's own "zamienię"-tagged
  // items — fetched only for those (not every item), so a listing owner
  // sees every competing proposal on the tile itself and can pick one
  // (the rest auto-reject server-side, see `accept_swap_proposal`).
  const [swapProposals, setSwapProposals] = useState<Record<string, SwapProposalOfferResponse[]>>({});
  const [acceptBusyProposalId, setAcceptBusyProposalId] = useState<string | null>(null);
  const [acceptedSwap, setAcceptedSwap] = useState<AcceptedSwap | null>(null);
  const [personalSwapAccepted, setPersonalSwapAccepted] = useState(false);
  const swapItemIds = items.filter((it) => modeOf(it) === "zamienię").map((it) => it.id);
  const swapItemIdsKey = swapItemIds.join(",");

  useEffect(() => {
    if (swapItemIds.length === 0) {
      setSwapProposals({});
      return;
    }
    let cancelled = false;
    void Promise.all(swapItemIds.map((id) => getSwapProposalsForItem(id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, SwapProposalOfferResponse[]> = {};
      swapItemIds.forEach((id, i) => {
        next[id] = results[i];
      });
      setSwapProposals(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapItemIdsKey]);

  async function handleAcceptSwapProposal(itemId: string, proposal: SwapProposalOfferResponse) {
    setActionError(null);
    setPersonalSwapAccepted(false);
    setAcceptBusyProposalId(proposal.id);
    try {
      const accepted = await acceptSwapProposal(proposal.id);
      // A personal swap has no date or place to show: the parties arrange it in the chat.
      if (isPersonalSwapAccept(accepted)) {
        setPersonalSwapAccepted(true);
      } else {
        setAcceptedSwap({
          myItemName: items.find((it) => it.id === itemId)?.product_name ?? "",
          offeredName: proposal.offered_product_name,
          occursOn: accepted.term_occurs_on,
          groupName: accepted.group_name,
          groupId: accepted.group_id,
          termId: accepted.term_id,
          eventId: accepted.event_id ?? null,
          eventSlug: accepted.event_slug ?? null,
          itemId,
          hadOtherOffers: (swapProposals[itemId]?.length ?? 0) > 1,
        });
      }
      setSwapProposals((s) => ({ ...s, [itemId]: [] }));
      await load({ silent: true });
    } catch (err) {
      setActionError(serverMessageOr(err, "Nie udało się zaakceptować propozycji — spróbuj ponownie"));
    } finally {
      setAcceptBusyProposalId(null);
    }
  }

  /** Confirm/cancel are open once the term has passed (personal: at once),
   * never on an unpaired SWAP leg. */
  function canSettle(itemId: string): boolean {
    const reservationId = itemsById.get(itemId)?.reservation_id;
    if (reservationId == null) return false;
    const info = reservationTermInfo[reservationId];
    return info !== undefined && info.hasEnded && !info.isUnpairedSwap;
  }

  function isGift(itemId: string): boolean {
    const reservationId = itemsById.get(itemId)?.reservation_id;
    if (reservationId == null) return false;
    return reservationTermInfo[reservationId]?.isGift === true;
  }

  async function handleConfirmReceipt(itemId: string) {
    const reservationId = itemsById.get(itemId)?.reservation_id;
    if (reservationId == null) return;
    setActionError(null);
    setActionBusyItemId(itemId);
    try {
      await confirmTransaction(reservationId);
      await load({ silent: true });
    } catch {
      setActionError("Nie udało się potwierdzić odbioru — spróbuj ponownie");
    } finally {
      setActionBusyItemId(null);
    }
  }

  async function handleCancelTransaction(itemId: string) {
    const reservationId = itemsById.get(itemId)?.reservation_id;
    if (reservationId == null) return;
    setActionError(null);
    setActionBusyItemId(itemId);
    try {
      await cancelTransaction(reservationId);
      await load({ silent: true });
    } catch {
      setActionError("Nie udało się anulować wymiany — spróbuj ponownie");
    } finally {
      setActionBusyItemId(null);
    }
  }

  const hasAnyItem = counts.ALL > 0;

  return (
    <div>
      {personalSwapAccepted && (
        <p role="status" className="mb-3 rounded-2xl bg-primary-soft px-3.5 py-2.5 text-[13px] font-bold text-primary-fg">
          {PERSONAL_SWAP_ACCEPTED_MESSAGE}
        </p>
      )}

      {paged.error && (
        <p role="alert" className="mb-3 text-center text-[13px] font-semibold text-danger">
          Nie udało się wczytać rzeczy — {paged.error}
        </p>
      )}

      {hasAnyItem && (
        <div role="search" aria-label="Filtruj rzeczy" className="mb-3 flex gap-2">
          <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border-[1.5px] border-line bg-paper pr-1 pl-3.5 focus-within:border-primary">
            <SearchIcon />
            <label htmlFor="my-items-search" className="sr-only">
              Szukaj po nazwie
            </label>
            <input
              id="my-items-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj po nazwie"
              className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-soft [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Wyczyść wyszukiwanie"
                className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-cream text-ink"
              >
                <CloseIcon />
              </button>
            )}
          </div>
          <label htmlFor="my-items-mode" className="sr-only">
            Tryb
          </label>
          <select
            id="my-items-mode"
            value={filter ?? ""}
            onChange={(e) => setFilter(e.target.value === "" ? null : (e.target.value as ItemMode))}
            className="min-h-11 flex-none rounded-full border-[1.5px] border-line bg-paper px-3.5 text-sm font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <option value="">Wszystkie ({counts.ALL})</option>
            {ITEM_MODES.map((m) => (
              <option key={m} value={m}>
                {capitalize(m)} ({counts[ITEM_MODE_TO_RESERVATION_TYPE[m] as MyItemsModeFilter]})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {paged.loading && (
          <p role="status" className="py-6 text-center text-[15px] text-ink-soft">
            Wczytywanie rzeczy…
          </p>
        )}
        {!paged.loading && !paged.error && !hasAnyItem && (
          <section className="flex flex-col items-center gap-2.5 rounded-[26px] border-2 border-dashed border-line-strong bg-paper px-5.5 py-7 text-center">
            <svg aria-hidden="true" width="112" height="112" viewBox="0 0 112 112">
              <circle cx="56" cy="56" r="44" className="fill-primary-soft" />
              <circle cx="56" cy="56" r="52" fill="none" className="stroke-primary/30" strokeWidth="2" strokeDasharray="5 8" />
              <g transform="translate(32 32)" fill="none" className="stroke-primary-fg" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M45 15 24 4 3 15v18l21 11 21-11z" />
                <path d="m3 15 21 11 21-11M24 26v18" />
              </g>
              <circle cx="96" cy="22" r="9" className="fill-accent" />
              <path d="M96 18v8M92 22h8" className="stroke-ink" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            <h2 className="font-serif text-[21px] font-extrabold text-ink">Nie masz jeszcze żadnej rzeczy</h2>
            <p className="max-w-70 text-[15px] leading-normal text-ink-soft">
              Dodaj wózek, książeczki albo kurtkę, z której dziecko wyrosło — i zdecyduj, czy ją oddasz, czy
              zamienisz.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-1.5" aria-hidden="true">
              {ITEM_MODES.map((m) => (
                <span key={m} className={`rounded-full px-3 py-1 text-[13px] font-extrabold ${MODE_TONE[m]}`}>
                  {capitalize(m)}
                </span>
              ))}
            </div>
            <Link
              to="/add/product"
              className="mt-2 flex min-h-12.5 items-center rounded-full bg-primary px-5.5 text-base font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              + Dodaj pierwszą rzecz
            </Link>
          </section>
        )}
        {hasAnyItem && !paged.loading && items.length === 0 && (
          <p role="status" className="py-6 text-center text-[15px] text-ink-soft">
            Brak rzeczy pasujących do filtra.
          </p>
        )}
        {items.map((it) => {
          const mode = modeOf(it);
          const locked = ACTIVE_LOCK_BALANCE_STATUSES.includes(it.balance_status);
          const badgeLabel = lockBadgeLabel(it.balance_status);
          // Informational only: pending photos dash the card border; the mode stays selectable.
          const photosPending = it.photos_moderation_pending === true;
          return (
            <div
              key={it.id}
              className={`relative rounded-[22px] border bg-paper p-3.5 transition-shadow hover:shadow-md ${photosPending ? "border-dashed border-line-strong" : "border-line"}`}
            >
              <div className="flex items-start gap-3">
                {/* Stretched link: the whole card opens the item; the controls
                    below sit on `relative z-10` above its overlay. */}
                <Link
                  to={itemPagePath(ownSlug, it.id)}
                  aria-label={`Zobacz rzecz ${it.product_name}`}
                  className={`flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-2xl after:absolute after:inset-0 after:rounded-[22px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${mode ? MODE_TONE[mode] : "bg-cream text-ink-soft"}`}
                >
                  {it.thumb_url ? (
                    <SafeImage src={it.thumb_url} alt="" className="size-full" placeholderSize={22} />
                  ) : (
                    <BoxIcon c="currentColor" />
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <h3 title={it.product_name} className="line-clamp-2 text-base leading-snug font-bold wrap-break-word text-ink">{it.product_name}</h3>
                  <small className="mt-0.5 block text-[13px] text-ink-soft">Stan: {CONDITION_LABELS[it.condition]}</small>
                </div>
                <div className="relative z-10 flex flex-none gap-1">
                  <Link to={itemEditPath(it.id)} aria-label={`Edytuj rzecz ${it.product_name}`} className={ICON_BUTTON}>
                    <PencilIcon />
                  </Link>
                  <button
                    onClick={() => void handleDeleteItem(it.id)}
                    aria-label={`Usuń rzecz ${it.product_name}`}
                    className={`${ICON_BUTTON} hover:border-danger hover:text-danger`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              {/* Lock pill and its actions first (an in-flight transaction the
                  user may have to act on), the moderation notice second. */}
              {(badgeLabel || (locked && canSettle(it.id))) && (
                <div className="relative z-10 mt-3 flex flex-wrap items-center gap-1.5">
                  {badgeLabel && <StatusPill label={badgeLabel} />}
                  {locked && canSettle(it.id) && (
                    <>
                      {!isGift(it.id) && (
                        <button
                          type="button"
                          onClick={() => void handleConfirmReceipt(it.id)}
                          disabled={actionBusyItemId === it.id}
                          className="min-h-9 rounded-full bg-primary px-3.5 text-[13px] font-extrabold text-on-primary disabled:opacity-60"
                        >
                          Odebrał
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleCancelTransaction(it.id)}
                        disabled={actionBusyItemId === it.id}
                        className="min-h-9 rounded-full px-3.5 text-[13px] font-extrabold text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
                      >
                        Anuluj wymianę
                      </button>
                    </>
                  )}
                </div>
              )}

              {photosPending ? (
                <div className="relative z-10 mt-3 rounded-2xl bg-cream px-3.5 py-2.5 text-[13px] leading-snug text-ink">
                  <StatusPill label="Zdjęcia w moderacji" />
                  <p className="mt-1.5">
                    <Link to={itemEditPath(it.id)} className="font-extrabold text-primary-fg underline">
                      Zobacz zdjęcia →
                    </Link>
                  </p>
                </div>
              ) : null}

              <div className="relative z-10 mt-3 flex gap-1.5">
                {ITEM_MODES.map((m) => {
                  const on = mode === m;
                  return (
                    <button
                      key={m}
                      onClick={() => void setItemMode(it.id, m)}
                      aria-pressed={on}
                      disabled={locked}
                      aria-disabled={locked}
                      className={`min-h-9 flex-1 rounded-full px-2 text-[13px] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        on ? MODE_TONE[m] : "border-[1.5px] border-dashed border-line-strong text-ink-soft hover:text-ink"
                      }`}
                    >
                      {on && <span aria-hidden="true">✓ </span>}
                      {capitalize(m)}
                    </button>
                  );
                })}
              </div>

              <div className="relative z-10 mt-2">
                {mode ? (
                  <div className="flex items-center gap-2">
                    <VisibilityToggle
                      value={it.listing_visibility ?? "PUBLIC"}
                      onChange={(v) => void setItemVisibility(it.id, mode, v)}
                      itemName={it.product_name}
                    />
                    {it.listing_visibility === "PRIVATE" && (
                      <p className="text-xs text-ink-soft">{PRIVATE_HINT}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-ink-soft">{NO_MODE_HINT}</p>
                )}
              </div>

              {(swapProposals[it.id]?.length ?? 0) > 0 && (
                <div className="relative z-10 mt-3 flex flex-col gap-1.5">
                  <small className="text-xs font-extrabold text-ink-soft">
                    Propozycje zamiany ({swapProposals[it.id]!.length})
                  </small>
                  {swapProposals[it.id]!.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-2xl bg-accent-soft px-3 py-2">
                      <span className="min-w-0 flex-1 text-[13px] text-ink">
                        <strong>{p.proposer_display_name}</strong> oferuje <strong>{p.offered_product_name}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleAcceptSwapProposal(it.id, p)}
                        disabled={acceptBusyProposalId !== null}
                        className="min-h-9 flex-none rounded-full bg-primary px-3.5 text-[13px] font-extrabold text-on-primary disabled:opacity-60"
                      >
                        Wybierz
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {actionError && <p className="mt-1.5 text-[13px] font-semibold text-danger">{actionError}</p>}
            </div>
          );
        })}
        {hasNextPage && <div ref={sentinel} aria-hidden="true" className="h-px" />}
        {fetchingNextPage && (
          <p role="status" className="text-center text-[13px] text-ink-soft">
            Wczytywanie kolejnych rzeczy…
          </p>
        )}
        {nextPageError && (
          <div className="flex flex-col items-center gap-1.5">
            <p role="alert" className="text-center text-xs font-semibold text-danger">
              Nie udało się wczytać kolejnych rzeczy
            </p>
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              className="min-h-11 rounded-full border-[1.5px] border-line bg-paper px-4 text-sm font-bold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Spróbuj ponownie
            </button>
          </div>
        )}
        {itemError && <p className="mt-2 text-[13px] font-semibold text-danger">{itemError}</p>}
      </div>

      {acceptedSwap && <SwapAcceptSuccessSheet swap={acceptedSwap} onClose={() => setAcceptedSwap(null)} />}
    </div>
  );
}
