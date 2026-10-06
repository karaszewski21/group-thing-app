import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ACTIVE_LOCK_BALANCE_STATUSES,
  getInventoryItemBalances,
  type BalanceStatus,
  type ItemBalanceSummary,
} from "../../../api/inventories";
import { cancelTransaction, confirmTransaction, getReservation } from "../../../api/reservations";
import { getTerm } from "../../../api/terms";
import {
  acceptSwapProposal,
  getSwapProposalsForItem,
  type SwapProposalOfferResponse,
} from "../../../api/termItemListings";
import { CONDITION_LABELS } from "../../../utils/productCategory";
import { BoxIcon, EyeIcon, PencilIcon, TrashIcon } from "../panelIcons";
import { capitalize, ITEM_MODE_STYLE, ITEM_MODES } from "../panelHelpers";
import { usePanelData } from "../panelDataStore";

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
      className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-line bg-cream px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft"
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
  // `currentTermHasOccurred()`, resolved the same bounded way
  // `itemBalances` itself is (one batched round-trip over the distinct
  // reservations/terms among the currently-locked items, never per-row).
  // Also kept local to this view, same rationale as `itemBalances` above.
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
    void (async () => {
      const reservations = await Promise.all(
        lockedReservationIds.map((id) => getReservation(id)),
      );
      const termIds = Array.from(
        new Set(
          reservations
            .map((r) => r.term_id)
            .filter((id): id is string => id !== undefined),
        ),
      );
      const terms = await Promise.all(termIds.map((id) => getTerm(id)));
      const termById = new Map(terms.map((t) => [t.id, t]));
      if (cancelled) return;
      const next: Record<string, { hasEnded: boolean }> = {};
      for (const r of reservations) {
        if (r.term_id === undefined) continue;
        const term = termById.get(r.term_id);
        next[r.id] = {
          hasEnded: term ? new Date(term.occurs_on).getTime() <= Date.now() : false,
        };
      }
      setReservationTermInfo(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemBalances]);

  const [actionBusyItemId, setActionBusyItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Pending swap offers against each of the caller's own "zamienię"-tagged
  // items — fetched only for those (not every item), so a listing owner
  // sees every competing proposal on the tile itself and can pick one
  // (the rest auto-reject server-side, see `accept_swap_proposal`).
  const [swapProposals, setSwapProposals] = useState<Record<string, SwapProposalOfferResponse[]>>({});
  const [acceptBusyProposalId, setAcceptBusyProposalId] = useState<string | null>(null);
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

  async function handleAcceptSwapProposal(itemId: string, proposalId: string) {
    setActionError(null);
    setAcceptBusyProposalId(proposalId);
    try {
      await acceptSwapProposal(proposalId);
      setSwapProposals((s) => ({ ...s, [itemId]: [] }));
      await load({ silent: true });
    } catch {
      setActionError("Nie udało się zaakceptować propozycji — spróbuj ponownie");
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

  return (
    <div>
      <div className="mb-3.5 flex items-start justify-between gap-2.5">
        <div>
          <h2 className="text-[19px] font-semibold text-ink">Moje rzeczy</h2>
          <small className="text-[12.5px] text-ink-soft">
            {items.length} {items.length === 1 ? "rzecz" : "rzeczy"}
          </small>
        </div>
        <Link
          to="/product/new"
          className="inline-flex flex-none items-center gap-1.5 rounded-full bg-ink px-[15px] py-2.5 text-[12.5px] font-extrabold text-[#EAF2E9] transition-transform hover:-translate-y-0.5"
        >
          + Dodaj rzecz
        </Link>
      </div>
      <div className="rounded-[22px] border border-line bg-paper p-2">
        {items.length === 0 && (
          <div className="rounded-2xl border-[1.5px] border-dashed border-line py-[26px] text-center text-[13.5px] text-ink-soft">
            Nie masz jeszcze żadnej rzeczy.
          </div>
        )}
        {items.map((it) => {
          const mode = itemModes[it.id] ?? null;
          const style = mode ? ITEM_MODE_STYLE[mode] : null;
          const locked = ACTIVE_LOCK_BALANCE_STATUSES.includes(
            itemBalances[it.id]?.status ?? "AVAILABLE",
          );
          const badgeLabel = lockBadgeLabel(itemBalances[it.id]?.status);
          // The server rejects a mode (409) while the product's photos are in
          // moderation, so block the toggles too. Plain OR with `locked`.
          const photosPending = it.photos_moderation_pending === true;
          const modeHintId = `mode-hint-${it.id}`;
          return (
            <div key={it.id} className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-line bg-cream p-[15px] first:mt-0">
              <span
                className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl"
                style={{ background: style ? style.bg : "var(--color-line)" }}
              >
                <BoxIcon c={style ? style.c : "#5C7069"} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15.5px] font-semibold text-ink">{it.product_name}</h3>
                <small className="mt-0.5 block text-[12.5px] text-ink-soft">
                  Stan: {CONDITION_LABELS[it.condition]}
                </small>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ITEM_MODES.map((m) => {
                    const on = mode === m;
                    const mStyle = ITEM_MODE_STYLE[m];
                    return (
                      <button
                        key={m}
                        onClick={() => void setItemMode(it.id, m)}
                        aria-pressed={on}
                        disabled={locked || photosPending}
                        aria-disabled={locked || photosPending}
                        aria-describedby={photosPending ? modeHintId : undefined}
                        className="rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] font-extrabold text-ink-soft transition-colors hover:border-sage disabled:opacity-60 disabled:cursor-not-allowed"
                        style={on ? { background: mStyle.bg, color: mStyle.c, borderColor: "transparent" } : undefined}
                      >
                        {capitalize(m)}
                      </button>
                    );
                  })}
                  {/* Lock pill first (an in-flight transaction the user may
                      have to act on), moderation pill second. */}
                  {badgeLabel && <StatusPill label={badgeLabel} />}
                  {photosPending && <StatusPill label="Zdjęcia w moderacji" />}
                  {locked && termHasEnded(it.id) && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleConfirmReceipt(it.id)}
                        disabled={actionBusyItemId === it.id}
                        className="flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60"
                      >
                        Odebrał
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCancelTransaction(it.id)}
                        disabled={actionBusyItemId === it.id}
                        className="flex-none rounded-[9px] px-3 py-1.5 text-[11.5px] font-extrabold text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
                      >
                        Anuluj wymianę
                      </button>
                    </>
                  )}
                </div>
                {photosPending && (
                  <p id={modeHintId} className="mt-1 text-[11.5px] text-ink-soft">
                    Tryb włączysz po zatwierdzeniu zdjęć.{" "}
                    <Link
                      to={`/product/${it.id}/edit`}
                      className="font-extrabold text-mint underline py-1"
                    >
                      Zobacz zdjęcia →
                    </Link>
                  </p>
                )}
                {(swapProposals[it.id]?.length ?? 0) > 0 && (
                  <div className="mt-2.5 flex flex-col gap-1.5">
                    <small className="text-[11.5px] font-extrabold text-ink-soft">
                      Propozycje zamiany ({swapProposals[it.id]!.length})
                    </small>
                    {swapProposals[it.id]!.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paper px-2.5 py-2"
                      >
                        <span className="min-w-0 flex-1 text-[12.5px] text-ink">
                          <strong>{p.proposer_display_name}</strong> oferuje{" "}
                          <strong>{p.offered_product_name}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleAcceptSwapProposal(it.id, p.id)}
                          disabled={acceptBusyProposalId !== null}
                          className="flex-none rounded-[9px] bg-mint px-2.5 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60"
                        >
                          Wybierz
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {actionError && (
                  <p className="mt-1.5 text-[12.5px] font-semibold text-danger">{actionError}</p>
                )}
              </div>
              <div className="flex flex-none flex-col gap-1">
                <Link
                  to={`/product/${it.id}`}
                  aria-label={`Zobacz rzecz ${it.product_name}`}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
                >
                  <EyeIcon />
                </Link>
                <Link
                  to={`/product/${it.id}/edit`}
                  aria-label={`Edytuj rzecz ${it.product_name}`}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
                >
                  <PencilIcon />
                </Link>
                <button
                  onClick={() => void handleDeleteItem(it.id)}
                  aria-label={`Usuń rzecz ${it.product_name}`}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] text-ink-soft hover:bg-danger-soft hover:text-danger"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          );
        })}
        {itemError && (
          <p className="mt-2 text-[12.5px] font-semibold text-danger">{itemError}</p>
        )}
      </div>
    </div>
  );
}
