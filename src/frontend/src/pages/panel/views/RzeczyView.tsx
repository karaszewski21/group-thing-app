import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ACTIVE_LOCK_BALANCE_STATUSES,
  getInventoryItemBalances,
  type BalanceStatus,
  type ItemBalanceSummary,
} from "../../../api/inventories";
import { serverMessageOr } from "../../../api/problem";
import { cancelTransaction, confirmTransaction, getReservation } from "../../../api/reservations";
import {
  acceptSwapProposal,
  getSwapProposalsForItem,
  type SwapProposalOfferResponse,
} from "../../../api/termItemListings";
import { CONDITION_LABELS } from "../../../utils/productCategory";
import { BoxIcon, PencilIcon, TrashIcon } from "../panelIcons";
import { capitalize, GIFT_LIMIT_MESSAGE, ITEM_MODES, MAX_GIFT_ITEMS, type ItemMode } from "../panelHelpers";
import { FloatingAddButton } from "../panelComponents";
import { usePanelData } from "../panelDataStore";
import { SafeImage } from "../../product/ItemGallery";
import { SwapAcceptSuccessSheet, type AcceptedSwap } from "./SwapAcceptSuccessSheet";

/** Soft tile + readable text per item mode, matching the exchange tones. */
const MODE_TONE: Record<ItemMode, string> = {
  "wypożyczę": "bg-teal-soft text-ink",
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
 * swap). `LENT`/`RETURNED`/`AVAILABLE` are settled states, not "pending",
 * so they render no badge here. This view is purely informational per
 * spec.md Requirement 12-13 — no action button is ever added next to it. */
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

export function RzeczyView() {
  const {
    items,
    itemModes,
    itemError,
    setItemMode,
    handleDeleteItem,
    load,
  } = usePanelData();

  // Per-item lock/pending status — kept local to this view (not lifted into
  // PanelDataContext) since nothing else needs it, per
  // `standards/frontend/components.md`'s "keep state as close to where
  // it's used as possible". One bounded fetch per `items` change (a single
  // `Promise.all` round-trip, not a per-item call inside the render loop —
  // see `api/inventories.ts`'s `getInventoryItemBalances`), not on every
  // render.
  const [itemBalances, setItemBalances] = useState<Record<string, ItemBalanceSummary>>({});
  useEffect(() => {
    if (items.length === 0) {
      setItemBalances({});
      return;
    }
    let cancelled = false;
    void getInventoryItemBalances(items.map((it) => it.id)).then((balances) => {
      if (!cancelled) setItemBalances(balances);
    });
    return () => {
      cancelled = true;
    };
  }, [items]);

  // Bug #4c: whether the active reservation's Term has already occurred,
  // keyed by `reservationId` — mirrors `TermPage.tsx`'s
  // `currentTermHasOccurred()`. The date comes with the reservation itself
  // (`term_occurs_on`), which still resolves when the Term's group is
  // soft-deleted, unlike `GET /terms/{id}`. Settled per reservation so one
  // failing fetch never hides the buttons of the other locked items.
  const [reservationTermInfo, setReservationTermInfo] = useState<
    Record<string, { hasEnded: boolean }>
  >({});
  useEffect(() => {
    const lockedReservationIds = Array.from(
      new Set(
        Object.values(itemBalances)
          .filter((b) => ACTIVE_LOCK_BALANCE_STATUSES.includes(b.status))
          .map((b) => b.reservationId)
          .filter((id): id is string => id !== null),
      ),
    );
    if (lockedReservationIds.length === 0) {
      setReservationTermInfo({});
      return;
    }
    let cancelled = false;
    void Promise.allSettled(lockedReservationIds.map((id) => getReservation(id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, { hasEnded: boolean }> = {};
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { id, term_occurs_on } = result.value;
        next[id] = {
          hasEnded: term_occurs_on != null && new Date(term_occurs_on).getTime() <= Date.now(),
        };
      }
      setReservationTermInfo(next);
    });
    return () => {
      cancelled = true;
    };
  }, [itemBalances]);

  const [filter, setFilter] = useState<ItemMode | null>(null);
  const [actionBusyItemId, setActionBusyItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Pending swap offers against each of the caller's own "zamienię"-tagged
  // items — fetched only for those (not every item), so a listing owner
  // sees every competing proposal on the tile itself and can pick one
  // (the rest auto-reject server-side, see `accept_swap_proposal`).
  const [swapProposals, setSwapProposals] = useState<Record<string, SwapProposalOfferResponse[]>>({});
  const [acceptBusyProposalId, setAcceptBusyProposalId] = useState<string | null>(null);
  const [acceptedSwap, setAcceptedSwap] = useState<AcceptedSwap | null>(null);
  const swapItemIds = items.filter((it) => itemModes[it.id] === "zamienię").map((it) => it.id);
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
    setAcceptBusyProposalId(proposal.id);
    try {
      const accepted = await acceptSwapProposal(proposal.id);
      setAcceptedSwap({
        myItemName: items.find((it) => it.id === itemId)?.product_name ?? "",
        offeredName: proposal.offered_product_name,
        occursOn: accepted.term_occurs_on,
        groupName: accepted.group_name,
        groupId: accepted.group_id,
        termId: accepted.term_id,
        itemId,
        hadOtherOffers: (swapProposals[itemId]?.length ?? 0) > 1,
      });
      setSwapProposals((s) => ({ ...s, [itemId]: [] }));
      await load({ silent: true });
    } catch (err) {
      setActionError(serverMessageOr(err, "Nie udało się zaakceptować propozycji — spróbuj ponownie"));
    } finally {
      setAcceptBusyProposalId(null);
    }
  }

  function termHasEnded(itemId: string): boolean {
    const reservationId = itemBalances[itemId]?.reservationId;
    if (reservationId == null) return false;
    return reservationTermInfo[reservationId]?.hasEnded === true;
  }

  async function handleConfirmReceipt(itemId: string) {
    const reservationId = itemBalances[itemId]?.reservationId;
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
    const reservationId = itemBalances[itemId]?.reservationId;
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

  const giftCount = items.filter((i) => itemModes[i.id] === "oddam").length;
  const giftLimitReached = giftCount >= MAX_GIFT_ITEMS;
  const shownItems = filter ? items.filter((it) => itemModes[it.id] === filter) : items;
  const filterChip = (on: boolean, tone: string) =>
    `min-h-10 rounded-full px-3.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
      on ? "bg-ink text-on-ink" : tone
    }`;

  return (
    <div>
      <div className="mb-4">
        <div>
          <h1 className="font-serif text-[32px] leading-tight font-extrabold tracking-tight text-ink">Moje rzeczy</h1>
          <small className="text-sm text-ink-soft">
            {items.length} {items.length === 1 ? "rzecz" : "rzeczy"}
          </small>
        </div>
      </div>

      {items.length > 0 && (
        <div role="group" aria-label="Filtruj rzeczy" className="mb-3 flex flex-wrap gap-2">
          <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)} className={filterChip(filter === null, "bg-paper text-ink border-[1.5px] border-line")}>
            Wszystkie {items.length}
          </button>
          {ITEM_MODES.map((m) => {
            const count = items.filter((it) => itemModes[it.id] === m).length;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={filter === m}
                onClick={() => setFilter(filter === m ? null : m)}
                className={filterChip(filter === m, MODE_TONE[m])}
              >
                {capitalize(m)} {count}
              </button>
            );
          })}
        </div>
      )}

      <p
        id="gift-limit-hint"
        className={`mb-3 text-[13px] ${giftLimitReached ? "font-bold text-ink" : "text-ink-soft"}`}
      >
        Do oddania: {giftCount}/{MAX_GIFT_ITEMS}
        {giftLimitReached && <> — {GIFT_LIMIT_MESSAGE}</>}
      </p>

      <div className="flex flex-col gap-3">
        {items.length === 0 && (
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
              Dodaj wózek, książeczki albo kurtkę, z której dziecko wyrosło — i zdecyduj, czy ją wypożyczysz, oddasz czy
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
              to="/product/new"
              className="mt-2 flex min-h-12.5 items-center rounded-full bg-primary px-5.5 text-base font-extrabold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              + Dodaj pierwszą rzecz
            </Link>
          </section>
        )}
        {shownItems.map((it) => {
          const mode = itemModes[it.id] ?? null;
          const locked = ACTIVE_LOCK_BALANCE_STATUSES.includes(itemBalances[it.id]?.status ?? "AVAILABLE");
          const badgeLabel = lockBadgeLabel(itemBalances[it.id]?.status);
          // The server rejects a mode (409) while the product's photos are in
          // moderation, so block the toggles too. Plain OR with `locked`.
          const photosPending = it.photos_moderation_pending === true;
          const modeHintId = `mode-hint-${it.id}`;
          return (
            <div
              key={it.id}
              className={`relative rounded-[22px] border bg-paper p-3.5 transition-shadow hover:shadow-md ${photosPending ? "border-dashed border-line-strong" : "border-line"}`}
            >
              <div className="flex items-start gap-3">
                {/* Stretched link: the whole card opens the item; the controls
                    below sit on `relative z-10` above its overlay. */}
                <Link
                  to={`/product/${it.id}`}
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
                  <Link to={`/product/${it.id}/edit`} aria-label={`Edytuj rzecz ${it.product_name}`} className={ICON_BUTTON}>
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
              {(badgeLabel || (locked && termHasEnded(it.id))) && (
                <div className="relative z-10 mt-3 flex flex-wrap items-center gap-1.5">
                  {badgeLabel && <StatusPill label={badgeLabel} />}
                  {locked && termHasEnded(it.id) && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleConfirmReceipt(it.id)}
                        disabled={actionBusyItemId === it.id}
                        className="min-h-9 rounded-full bg-primary px-3.5 text-[13px] font-extrabold text-on-primary disabled:opacity-60"
                      >
                        Odebrał
                      </button>
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
                  <p id={modeHintId} className="mt-1.5">
                    Tryb włączysz po zatwierdzeniu zdjęć.{" "}
                    <Link to={`/product/${it.id}/edit`} className="font-extrabold text-primary-fg underline">
                      Zobacz zdjęcia →
                    </Link>
                  </p>
                </div>
              ) : null}

              <div className="relative z-10 mt-3 flex gap-1.5">
                {ITEM_MODES.map((m) => {
                  const on = mode === m;
                  const overGiftLimit = m === "oddam" && !on && giftLimitReached;
                  const disabled = locked || photosPending || overGiftLimit;
                  return (
                    <button
                      key={m}
                      onClick={() => void setItemMode(it.id, m)}
                      aria-pressed={on}
                      disabled={disabled}
                      aria-disabled={disabled}
                      aria-describedby={photosPending ? modeHintId : overGiftLimit ? "gift-limit-hint" : undefined}
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
        {itemError && <p className="mt-2 text-[13px] font-semibold text-danger">{itemError}</p>}
      </div>

      <FloatingAddButton label="Dodaj rzecz" to="/product/new" />
      {acceptedSwap && <SwapAcceptSuccessSheet swap={acceptedSwap} onClose={() => setAcceptedSwap(null)} />}
    </div>
  );
}
