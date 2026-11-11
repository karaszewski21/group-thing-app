import { api, ApiError } from "./client";

export type ReservationType = "LEND" | "RETURN" | "SWAP" | "GIFT";
export type ReservationStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "FULFILLED";

export interface ReservationResponse {
  id: string;
  item_id: string;
  reservation_type: ReservationType;
  reserved_by_user_id: string;
  // Optional here (not on the actual backend response, which always sets
  // it — see `inventory/schemas.py`'s `ReservationResponse.term_id`)
  // purely so pre-existing mocked `ReservationResponse` object literals in
  // `TermPage.test.tsx`/`AppPage.test.tsx` (written before this
  // field existed on the frontend type) keep compiling without an
  // unrelated, out-of-scope rewrite.
  // `null` for an event reservation, which sets `event_id` instead.
  term_id?: string | null;
  event_id?: string | null;
  paired_reservation_id: string | null;
  reserved_at: string;
  expires_at: string | null;
  status: ReservationStatus;
  notes: string | null;
}

export function getReservations(itemId: string): Promise<ReservationResponse[]> {
  return api.get(`/reservations?item_id=${itemId}`);
}

/** `GET /reservations/{id}` adds the context date (the Term's, or the
 * event's start), resolved server-side even when the Term's group is
 * soft-deleted (`GET /terms/{id}` is then 404).
 * Optional for the same pre-existing-mock reason as `term_id` above. */
export interface ReservationDetailResponse extends ReservationResponse {
  term_occurs_on?: string | null;
  /** Arranged at the owner's place, with no term or event. */
  personal_pickup: boolean;
}

export function getReservation(id: string): Promise<ReservationDetailResponse> {
  return api.get(`/reservations/${id}`);
}

/** One row of `GET /reservations/mine`: an item the caller is about to
 * receive. `PROPOSED` is their swap offer still awaiting the owner
 * (`reservation_id` null). `occurs_at` is the term's or event's naive
 * Warsaw time, null for a personal pickup. */
export interface MyReservationResponse {
  item_id: string;
  product_name: string;
  thumb_url: string | null;
  item_path: string;
  owner_name: string;
  mode: "GIFT" | "SWAP";
  status: "PROPOSED" | "PENDING" | "CONFIRMED";
  reservation_id: string | null;
  context_kind: "TERM" | "EVENT" | "PERSONAL";
  context_name: string | null;
  occurs_at: string | null;
  reserved_at: string;
}

export function getMyReservations(): Promise<MyReservationResponse[]> {
  return api.get("/reservations/mine");
}

/** `already_resolved` is the explicit discriminator the global pending-
 * actions modal uses to render "the other party already resolved this"
 * distinctly from a generic error — it is only ever `true` when this
 * response accompanies a 409 (see `api/client.ts`'s `ApiError`, whose
 * `body` carries this same shape on that status). */
export interface ConfirmTransactionResponse {
  reservation_id: string;
  status: string;
  already_resolved: boolean;
}

/** The backend gates on the reservation's own Term (`reservation.term_id`
 * → `term.occurs_on`), so no request body is sent. */
export function confirmTransaction(reservationId: string): Promise<ConfirmTransactionResponse> {
  return api.post(`/reservations/${reservationId}/confirm-transaction`, undefined);
}

/** Mirrors `confirmTransaction` exactly — same shared gating helper
 * backend-side (`_resolve_transaction_reservations_for_action`), same
 * `already_resolved`-discriminated 409 race-loss shape. */
export type CancelTransactionResponse = ConfirmTransactionResponse;

export function cancelTransaction(reservationId: string): Promise<CancelTransactionResponse> {
  return api.post(`/reservations/${reservationId}/cancel-transaction`, undefined);
}

export const ALREADY_RESOLVED_MESSAGE = "Transakcja została już rozstrzygnięta przez drugą stronę.";

/** A confirm/cancel that lost the race: the 409 whose body carries
 * `already_resolved: true` because the other party settled it first. */
export function isAlreadyResolved(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    typeof err.body === "object" &&
    err.body !== null &&
    (err.body as { already_resolved?: unknown }).already_resolved === true
  );
}
